import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { BudgetApiService } from '../../core/budget-api.service';
import { downloadBlob } from '../../core/download';
import {
  filterRows,
  nodeAt,
  overspentCategoryCount,
  overspentLineCount,
  sortRows,
} from '../../core/drill';
import {
  formatFull,
  formatPercent,
  formatValue,
  meterWidth,
  percent,
  safeFileName,
  sumValues,
  toCsv,
} from '../../core/format';
import {
  DashboardScale,
  DashboardView,
  DatasetDetail,
  DatasetSummary,
  DrillRow,
  SortKey,
  Units,
} from '../../core/models';
import { SourceChipService } from '../../core/source-chip.service';

interface TooltipState {
  row: DrillRow;
  x: number;
  y: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(BudgetApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly chip = inject(SourceChipService);
  readonly auth = inject(AuthService);

  private readonly destroy$ = new Subject<void>();

  readonly datasets = signal<DatasetSummary[]>([]);
  readonly dataset = signal<DatasetDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly path = signal<number[]>([]);
  readonly view = signal<DashboardView>('chart');
  readonly scale = signal<DashboardScale>('absolute');
  readonly units = signal<Units>('full');
  readonly sortKey = signal<SortKey>('code');
  readonly sortDir = signal<1 | -1>(-1);
  readonly query = signal('');
  readonly tooltip = signal<TooltipState | null>(null);

  readonly model = computed(() => this.dataset()?.model ?? null);
  readonly isRoot = computed(() => this.path().length === 0);
  readonly node = computed(() => nodeAt(this.model(), this.path()));
  readonly allRows = computed(() => this.node().children);
  readonly rows = computed(() =>
    sortRows(filterRows(this.allRows(), this.query()), this.sortKey(), this.sortDir()),
  );

  readonly utilisation = computed(() => {
    const v = this.node().values;
    return percent(v.consumed, v.consumable);
  });
  readonly remaining = computed(() => {
    const v = this.node().values;
    return percent(v.available, v.consumable);
  });
  readonly overspentLines = computed(() => overspentLineCount(this.model(), this.path()));
  readonly overspentCats = computed(() => overspentCategoryCount(this.model()));
  readonly maxConsumable = computed(() =>
    Math.max(1, ...this.rows().map((r) => Math.abs(r.values.consumable))),
  );
  readonly totals = computed(() => sumValues(this.rows()));

  readonly rootLabel = computed(() => this.model()?.deptName || 'All funds centres');

  /* re-exported for the template */
  readonly formatFull = formatFull;
  readonly formatPercent = formatPercent;
  readonly percent = percent;
  readonly meterWidth = meterWidth;

  /**
   * True on `/shared/:token`. The same component serves both views so a shared
   * link shows exactly the numbers the signed-in page shows; this flag is what
   * removes every action an anonymous visitor must not have.
   */
  readonly shared = signal(false);

  /* ── Share link (owner side) ── */
  readonly shareOpen = signal(false);
  readonly shareBusy = signal(false);
  readonly shareUrl = signal<string | null>(null);
  readonly shareError = signal<string | null>(null);
  readonly shareCopied = signal(false);

  ngOnInit(): void {
    // Optional-chained: a route may be provided without a snapshot (the unit
    // tests do exactly that), and defaulting to the signed-in view is the safe
    // direction to fail — it shows less, not more.
    if (this.route.snapshot?.data?.['shared']) {
      this.shared.set(true);
      this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        this.loadShared(params.get('token'));
      });
      return;
    }
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.load(params.get('id'));
    });
  }

  /** Loads through the public endpoint — no session, no dataset list. */
  private loadShared(token: string | null): void {
    if (!token) {
      this.error.set('That link is not valid.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getSharedDataset(token)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (d) => {
          this.dataset.set(d);
          this.chip.set(d.fileName);
          this.path.set([]);
          this.query.set('');
          this.loading.set(false);
        },
        error: () => {
          this.error.set('This link is no longer valid, or it has been revoked.');
          this.loading.set(false);
        },
      });
  }

  // ─── Sharing ────────────────────────────────────────────────────────────────

  private shareLinkFor(token: string): string {
    return `${window.location.origin}/shared/${token}`;
  }

  /** Opens the panel, and asks whether a link already exists. */
  toggleShare(): void {
    const next = !this.shareOpen();
    this.shareOpen.set(next);
    this.shareCopied.set(false);
    if (!next) return;

    const id = this.dataset()?.id;
    if (!id) return;
    this.shareBusy.set(true);
    this.shareError.set(null);
    this.api
      .getShare(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.shareUrl.set(s.token ? this.shareLinkFor(s.token) : null);
          this.shareBusy.set(false);
        },
        error: () => {
          this.shareError.set('Could not check the link for this file.');
          this.shareBusy.set(false);
        },
      });
  }

  createShare(): void {
    const id = this.dataset()?.id;
    if (!id) return;
    this.shareBusy.set(true);
    this.shareError.set(null);
    this.api
      .createShare(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (s) => {
          this.shareUrl.set(s.token ? this.shareLinkFor(s.token) : null);
          this.shareBusy.set(false);
        },
        error: () => {
          this.shareError.set('Could not create a link.');
          this.shareBusy.set(false);
        },
      });
  }

  revokeShare(): void {
    const id = this.dataset()?.id;
    if (!id) return;
    this.shareBusy.set(true);
    this.shareError.set(null);
    this.api
      .revokeShare(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.shareUrl.set(null);
          this.shareCopied.set(false);
          this.shareBusy.set(false);
        },
        error: () => {
          this.shareError.set('Could not revoke the link.');
          this.shareBusy.set(false);
        },
      });
  }

  async copyShareUrl(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.shareCopied.set(true);
    } catch {
      // Clipboard access can be refused (permissions, insecure context); the
      // input beside the button is selectable, so this is not a dead end.
      this.shareError.set('Copy the link from the box above.');
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Escape walks back up one level, matching the prototype. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.path().length) {
      this.path.set([]);
      this.tooltip.set(null);
    }
  }

  private load(id: string | null): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .listDatasets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (list) => {
          this.datasets.set(list);
          const target = id ?? list[0]?.id ?? null;
          if (!target) {
            this.dataset.set(null);
            this.chip.clear();
            this.loading.set(false);
            return;
          }
          this.loadDataset(target);
        },
        error: () => {
          this.error.set('Could not load the dataset history.');
          this.loading.set(false);
        },
      });
  }

  private loadDataset(id: string): void {
    this.api
      .getDataset(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (d) => {
          this.dataset.set(d);
          this.chip.set(d.fileName);
          this.path.set([]);
          this.query.set('');
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load that dataset.');
          this.loading.set(false);
        },
      });
  }

  fmt(n: number | null | undefined): string {
    return formatValue(n, this.units());
  }

  drillInto(row: DrillRow): void {
    if (!this.isRoot()) return;
    this.path.set([row.index]);
    this.query.set('');
    this.tooltip.set(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  toRoot(): void {
    this.path.set([]);
    this.query.set('');
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    } else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' ? 1 : -1);
    }
  }

  toggleSortDir(): void {
    this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
  }

  onSearch(value: string): void {
    this.query.set(value);
  }

  /** Bar width: normalised to its own budget in utilisation mode. */
  barWidth(row: DrillRow): number {
    if (this.scale() === 'utilization') return 100;
    return Math.max((Math.abs(row.values.consumable) / this.maxConsumable()) * 100, 0.35);
  }

  consumedWidth(row: DrillRow): number {
    return meterWidth(percent(row.values.consumed, row.values.consumable));
  }

  isOver(row: DrillRow): boolean {
    return row.values.available < 0 || row.values.consumable <= 0;
  }

  share(row: DrillRow): number | null {
    return percent(row.values.consumable, this.node().values.consumable);
  }

  showTip(event: MouseEvent, row: DrillRow): void {
    this.tooltip.set({ row, x: event.clientX, y: event.clientY });
  }

  hideTip(): void {
    this.tooltip.set(null);
  }

  tooltipStyle(): Record<string, string> {
    const t = this.tooltip();
    if (!t) return {};
    const pad = 14;
    const w = 260;
    const h = 150;
    let x = t.x + pad;
    let y = t.y + pad;
    if (x + w > window.innerWidth - 8) x = t.x - w - pad;
    if (y + h > window.innerHeight - 8) y = t.y - h - pad;
    return { left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px` };
  }

  exportCsv(): void {
    const d = this.dataset();
    if (!d) return;
    const categoryIndex = this.path().length ? this.path()[0] : undefined;
    this.api
      .exportCsv(d.id, categoryIndex)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => downloadBlob(blob, this.exportName()),
        // The server export is optional; the view already holds everything
        // needed to produce the same file locally.
        error: () => this.exportLocally(),
      });
  }

  private exportName(): string {
    return this.path().length
      ? `${safeFileName(this.node().name)}.csv`
      : 'budget_all.csv';
  }

  private exportLocally(): void {
    const node = this.node();
    const drilled = this.path().length > 0;
    const rows: (string | number)[][] = [
      ['Level', 'Name', 'Consumable Budget', 'Consumed Budget', 'Available Amount', 'Utilisation %'],
      [
        drilled ? 'Category' : 'Total',
        node.name,
        node.values.consumable,
        node.values.consumed,
        node.values.available,
        (percent(node.values.consumed, node.values.consumable) ?? 0).toFixed(2),
      ],
    ];
    for (const r of this.rows()) {
      rows.push([
        drilled ? 'Sub-Category' : 'Category',
        r.name,
        r.values.consumable,
        r.values.consumed,
        r.values.available,
        (percent(r.values.consumed, r.values.consumable) ?? 0).toFixed(2),
      ]);
    }
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), this.exportName());
  }
}
