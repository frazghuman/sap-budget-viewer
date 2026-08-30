import { CommonModule } from '@angular/common';
import { HttpEvent, HttpEventType } from '@angular/common/http';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { BudgetApiService } from '../../core/budget-api.service';
import { formatCompact, formatFull } from '../../core/format';
import {
  COLUMN_MAP_KEYS,
  ColumnMap,
  ColumnMapKey,
  DatasetDetail,
  Finding,
  FindingLevel,
  InspectResult,
} from '../../core/models';
import { SourceChipService } from '../../core/source-chip.service';

interface ProgressRow {
  label: string;
  state: '' | 'run' | 'ok' | 'err';
  detail?: string;
}

const FINDING_ORDER: Record<FindingLevel, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.scss',
})
export class UploadComponent implements OnDestroy {
  private readonly api = inject(BudgetApiService);
  private readonly router = inject(Router);
  private readonly chip = inject(SourceChipService);
  readonly auth = inject(AuthService);

  private readonly destroy$ = new Subject<void>();
  private file: File | null = null;

  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly step = signal(1);
  readonly dragOver = signal(false);
  readonly progress = signal<ProgressRow[]>([]);
  readonly result = signal<InspectResult | null>(null);
  readonly busy = signal(false);
  readonly importing = signal(false);
  readonly error = signal<string | null>(null);

  readonly columnKeys = COLUMN_MAP_KEYS;
  readonly columnLabels: Record<ColumnMapKey, string> = {
    label: 'Funds Center / Commitment Item',
    consumable: 'Consumable budget',
    consumed: 'Consumed budget',
    available: 'Available amount',
  };

  readonly model = computed(() => this.result()?.model ?? null);
  readonly headers = computed(() => this.result()?.headers ?? []);
  readonly sheets = computed(() => this.result()?.source.sheets ?? []);
  readonly fileName = computed(() => this.result()?.source.fileName ?? this.file?.name ?? '');

  readonly sortedFindings = computed<Finding[]>(() => {
    const f = this.model()?.findings ?? [];
    return f.slice().sort((a, b) => FINDING_ORDER[a.level] - FINDING_ORDER[b.level]);
  });
  readonly blockingCount = computed(
    () => (this.model()?.findings ?? []).filter((f) => f.level === 'crit').length,
  );
  readonly advisoryCount = computed(
    () => (this.model()?.findings ?? []).filter((f) => f.level === 'warn').length,
  );
  readonly passedCount = computed(
    () => (this.model()?.findings ?? []).filter((f) => f.level === 'ok').length,
  );
  readonly canImport = computed(
    () => this.auth.canUpload() && !!this.model()?.cats.length && !this.importing(),
  );

  readonly formatFull = formatFull;
  readonly formatCompact = formatCompact;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /* -------------------------------------------------------------- intake */

  browse(): void {
    this.fileInput()?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  handleFile(file: File): void {
    this.file = file;
    this.result.set(null);
    this.error.set(null);
    this.step.set(2);
    this.inspect(undefined, undefined, file);
  }

  reset(): void {
    this.file = null;
    this.result.set(null);
    this.progress.set([]);
    this.error.set(null);
    this.step.set(1);
    this.chip.clear();
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  /* ------------------------------------------------------------ inspect */

  private inspect(sheetIdx?: number, map?: ColumnMap, file?: File): void {
    const target = file ?? this.file;
    if (!target) return;

    this.busy.set(true);
    this.error.set(null);
    const rows: ProgressRow[] = [
      { label: `Uploading ${target.name}`, state: 'run', detail: `${(target.size / 1024).toFixed(1)} KB` },
      { label: 'Detecting format and delimiter', state: '' },
      { label: 'Mapping columns', state: '' },
      { label: 'Validating hierarchy', state: '' },
    ];
    this.progress.set([...rows]);

    this.api
      .inspectFile(this.api.buildForm(target, sheetIdx, map))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (event: HttpEvent<InspectResult>) => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            rows[0].detail = `${Math.round((event.loaded / event.total) * 100)}%`;
            this.progress.set([...rows]);
          }
          if (event.type === HttpEventType.Response && event.body) {
            this.applyResult(event.body, rows);
          }
        },
        error: (err: unknown) => {
          rows.forEach((r) => {
            if (!r.state || r.state === 'run') r.state = 'err';
          });
          rows[0].detail = this.messageOf(err);
          this.progress.set([...rows]);
          this.error.set(this.messageOf(err));
          this.busy.set(false);
          this.step.set(1);
        },
      });
  }

  private applyResult(res: InspectResult, rows: ProgressRow[]): void {
    const m = res.model;
    rows[0].state = 'ok';
    rows[0].detail = `${((this.file?.size ?? 0) / 1024).toFixed(1)} KB`;
    rows[1].state = 'ok';
    rows[1].detail =
      res.source.kind === 'text'
        ? `delimited text (${res.source.delim === '\t' ? 'TAB' : res.source.delim})`
        : `${res.source.kind.toUpperCase()} workbook · ${res.source.sheets.length} sheet${
            res.source.sheets.length > 1 ? 's' : ''
          }`;

    const missing = COLUMN_MAP_KEYS.filter((k) => res.map[k] < 0);
    rows[2].state = missing.length ? 'err' : 'ok';
    rows[2].detail = missing.length
      ? `could not identify: ${missing.join(', ')}`
      : '4 of 4 matched';

    rows[3].state = 'ok';
    rows[3].detail = `${m.cats.length} categories · ${m.lineCount} lines`;

    this.progress.set([...rows]);
    this.result.set(res);
    this.chip.set(res.source.fileName);
    this.busy.set(false);
    this.step.set(3);
  }

  onColumnChange(key: ColumnMapKey, value: string): void {
    const res = this.result();
    if (!res) return;
    const next: ColumnMap = { ...res.map, [key]: Number(value) };
    this.inspect(res.sheetIdx, next);
  }

  onSheetChange(value: string): void {
    const res = this.result();
    if (!res) return;
    this.inspect(Number(value));
  }

  headerLabel(header: string, index: number): string {
    const trimmed = (header ?? '').trim();
    return trimmed || `Column ${String.fromCharCode(65 + index)}`;
  }

  /* ------------------------------------------------------------- import */

  import(): void {
    const res = this.result();
    if (!res || !this.file || !this.canImport()) return;

    this.importing.set(true);
    this.error.set(null);
    this.step.set(4);

    this.api
      .importFile(this.api.buildForm(this.file, res.sheetIdx, res.map))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (event: HttpEvent<DatasetDetail>) => {
          if (event.type === HttpEventType.Response && event.body) {
            this.importing.set(false);
            this.router.navigate(['/datasets', event.body.id]);
          }
        },
        error: (err: unknown) => {
          this.importing.set(false);
          this.step.set(3);
          this.error.set(this.messageOf(err));
        },
      });
  }

  private messageOf(err: unknown): string {
    const e = err as { status?: number; error?: { message?: string }; message?: string };
    if (e?.status === 403) return 'You do not have permission to import budget data.';
    if (e?.status === 0) return 'The backend is unreachable.';
    return e?.error?.message || e?.message || 'The file could not be processed.';
  }
}
