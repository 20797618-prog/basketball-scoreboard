declare class Worker {
  constructor(stringUrl: string, options?: WorkerOptions);
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

interface WorkerOptions {
  name?: string;
  type?: 'classic' | 'module';
}

type WorkerType = 'classic' | 'module';

type Transferable = ArrayBuffer | MessagePort | ImageBitmap;

interface Event {
  type: string;
}

interface MessagePort {}

interface ImageBitmap {}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface CacheQueryOptions {
  ignoreSearch?: boolean;
  ignoreMethod?: boolean;
  ignoreVary?: boolean;
  cacheName?: string;
}
