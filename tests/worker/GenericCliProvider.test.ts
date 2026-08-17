import { describe, it, expect, mock, spyOn } from 'bun:test';
import { GenericCliProvider } from '../../src/services/worker/GenericCliProvider.js';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

describe('GenericCliProvider', () => {
  it('isAvailable returns true when process exits with 0', async () => {
    const provider = new GenericCliProvider({
      name: 'test-cli',
      binary: 'test-bin',
      model: 'default',
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = () => {};
    spyOn(child_process, 'spawn').mockReturnValue(mockProcess);

    const promise = provider.isAvailable();
    mockProcess.emit('close', 0);
    const available = await promise;
    expect(available).toBe(true);
  });

  it('isAvailable returns false when process errors', async () => {
    const provider = new GenericCliProvider({
      name: 'test-cli',
      binary: 'test-bin',
      model: 'default',
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = () => {};
    spyOn(child_process, 'spawn').mockReturnValue(mockProcess);

    const promise = provider.isAvailable();
    mockProcess.emit('error', new Error('Not found'));
    const available = await promise;
    expect(available).toBe(false);
  });

  it('extract returns output from stdout', async () => {
    const provider = new GenericCliProvider({
      name: 'test-cli',
      binary: 'test-bin',
      model: 'test-model',
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = {
      write: mock(),
      end: mock(),
    };
    spyOn(child_process, 'spawn').mockReturnValue(mockProcess);

    const promise = provider.extract({ prompt: 'Hello world' });
    
    // Simulate stdout data
    mockProcess.stdout.emit('data', Buffer.from('Extracted response'));
    mockProcess.emit('close', 0);
    
    const result = await promise;
    expect(result).toBe('Extracted response');
    
    // Assert process was spawned with model argument
    expect(child_process.spawn).toHaveBeenCalledWith('test-bin', ['--model', 'test-model'], expect.any(Object));
  });

  it('extract Structured handles JSON', async () => {
    const provider = new GenericCliProvider({
      name: 'test-cli',
      binary: 'test-bin',
      model: 'default',
    });

    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = {
      write: mock(),
      end: mock(),
    };
    spyOn(child_process, 'spawn').mockReturnValue(mockProcess);

    const promise = provider.extractStructured({ prompt: 'Hello' });
    mockProcess.stdout.emit('data', Buffer.from('{"key": "structured data"}'));
    mockProcess.emit('close', 0);
    
    const result = await promise;
    expect(result).toEqual({ key: 'structured data' });
  });
});
