import { spawn } from 'child_process';
import type { LlmProvider } from '../../shared/LlmProvider.js';
import { logger } from '../../utils/logger.js';

export interface GenericCliProviderOptions {
  name: string;
  binary: string;
  model: string;
}

export class GenericCliProvider implements LlmProvider {
  name: string;
  model: string;
  private binary: string;

  constructor(opts: GenericCliProviderOptions) {
    this.name = opts.name;
    this.binary = opts.binary;
    this.model = opts.model;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(this.binary, ['--version'], { stdio: 'pipe', timeout: 5000 });
        let completed = false;

        proc.on('close', (code) => {
          if (!completed) {
            completed = true;
            // Many CLIs return 0 on --version. If they don't, we might need a different check, 
            // but this is a reasonable default for generic CLI providers.
            resolve(code === 0);
          }
        });

        proc.on('error', () => {
          if (!completed) {
            completed = true;
            resolve(false);
          }
        });

        setTimeout(() => {
          if (!completed) {
            completed = true;
            try { proc.kill(); } catch {}
            resolve(false);
          }
        }, 5500);
      } catch {
        resolve(false);
      }
    });
  }

  async extract(input: { prompt: string; maxTokens?: number; temperature?: number }): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      try {
        // Assume standard input usage. Adjust arguments here if specific CLIs require different flags.
        // For generic, we pipe the prompt via stdin.
        const args = this.model !== 'default' ? ['--model', this.model] : [];
        const proc = spawn(this.binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code: number) => {
          if (code === 0) {
            // Attempt to parse JSON, otherwise return raw stdout
            try {
              const parsed = JSON.parse(stdout.trim());
              const response = parsed.response ?? parsed.content ?? stdout.trim();
              resolve(response);
            } catch {
              resolve(stdout.trim());
            }
          } else {
            const error = stderr.trim() || `${this.binary} CLI exited with code ${code}`;
            reject(new Error(error));
          }
        });

        proc.on('error', (err: any) => {
          if (err.code === 'ENOENT') {
            reject(new Error(`CLI binary not found: ${this.binary}`));
          } else {
            reject(err);
          }
        });

        proc.stdin.write(input.prompt);
        proc.stdin.end();
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          reject(new Error(`CLI binary not found: ${this.binary}`));
        } else {
          reject(err);
        }
      }
    });
  }

  async extractStructured(input: {
    prompt: string;
    schema?: any;
    maxTokens?: number;
  }): Promise<any> {
    const text = await this.extract(input);
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  getSpeed(): 'fast' {
    return 'fast';
  }
}
