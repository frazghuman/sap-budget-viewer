import { Injectable, signal } from '@angular/core';

/** The active source, shown in the top bar from wherever the router is. */
@Injectable({ providedIn: 'root' })
export class SourceChipService {
  private readonly sourceSignal = signal<string | null>(null);
  readonly source = this.sourceSignal.asReadonly();

  set(name: string | null): void {
    this.sourceSignal.set(name);
  }

  clear(): void {
    this.sourceSignal.set(null);
  }
}
