import { DatePipe } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth.service';
import { BudgetApiService } from './core/budget-api.service';
import { DatasetSummary } from './core/models';
import { SourceChipService } from './core/source-chip.service';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, DatePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  readonly title = 'Budget Control — Funds Center Analysis';
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  readonly chip = inject(SourceChipService);
  private readonly api = inject(BudgetApiService);
  private readonly router = inject(Router);

  readonly datasetDialogOpen = signal(false);
  readonly datasetLoading = signal(false);
  readonly datasetError = signal<string | null>(null);
  readonly datasetQuery = signal('');
  readonly datasets = signal<DatasetSummary[]>([]);
  readonly deleteCandidate = signal<DatasetSummary | null>(null);
  readonly deleting = signal(false);
  readonly userMenuOpen = signal(false);

  readonly filteredDatasets = computed(() => {
    const query = this.datasetQuery().trim().toLowerCase();
    if (!query) return this.datasets();
    return this.datasets().filter((dataset) =>
      [
        dataset.fileName,
        dataset.deptName,
        dataset.sheetName,
        dataset.uploadedByName,
        dataset.uploadedByEmail,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  });

  ngOnInit(): void {
    this.auth.loadSession().subscribe();
  }

  /** The label names the theme you would switch TO. */
  get themeLabel(): string {
    return this.theme.theme() === 'dark' ? 'Light' : 'Dark';
  }

  openDatasetDialog(): void {
    if (!this.auth.canView()) return;
    this.datasetDialogOpen.set(true);
    this.datasetQuery.set('');
    this.deleteCandidate.set(null);
    this.loadDatasets();
  }

  closeDatasetDialog(): void {
    if (this.deleting()) return;
    this.datasetDialogOpen.set(false);
    this.deleteCandidate.set(null);
  }

  selectDataset(dataset: DatasetSummary): void {
    this.closeDatasetDialog();
    this.router.navigate(['/datasets', dataset.id]);
  }

  confirmDelete(dataset: DatasetSummary, event: Event): void {
    event.stopPropagation();
    this.deleteCandidate.set(dataset);
  }

  cancelDelete(): void {
    this.deleteCandidate.set(null);
  }

  deleteDataset(): void {
    const candidate = this.deleteCandidate();
    if (!candidate || !this.auth.canDelete()) return;
    this.deleting.set(true);
    this.datasetError.set(null);
    this.api.deleteDataset(candidate.id).subscribe({
      next: () => {
        const remaining = this.datasets().filter((d) => d.id !== candidate.id);
        this.datasets.set(remaining);
        this.deleteCandidate.set(null);
        this.deleting.set(false);

        if (this.currentDatasetId() === candidate.id) {
          const next = remaining[0];
          if (next) {
            this.router.navigate(['/datasets', next.id]);
          } else {
            this.chip.clear();
            this.closeDatasetDialog();
            this.router.navigate(['/']);
          }
        }
      },
      error: () => {
        this.datasetError.set('Could not delete this dataset. Check your permission and try again.');
        this.deleting.set(false);
      },
    });
  }

  isCurrent(dataset: DatasetSummary): boolean {
    return this.currentDatasetId() === dataset.id;
  }

  toggleUserMenu(event: Event): void {
    // Kept off the document handler below, which would close it again.
    event.stopPropagation();
    this.userMenuOpen.set(!this.userMenuOpen());
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  signOut(): void {
    this.closeUserMenu();
    this.auth.logout();
  }

  /** Any click outside the menu dismisses it. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.userMenuOpen()) this.closeUserMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.userMenuOpen()) this.closeUserMenu();
    else if (this.deleteCandidate()) this.cancelDelete();
    else if (this.datasetDialogOpen()) this.closeDatasetDialog();
  }

  private loadDatasets(): void {
    this.datasetLoading.set(true);
    this.datasetError.set(null);
    this.api.listDatasets().subscribe({
      next: (datasets) => {
        this.datasets.set(datasets);
        this.datasetLoading.set(false);
      },
      error: () => {
        this.datasetError.set('Could not load datasets.');
        this.datasetLoading.set(false);
      },
    });
  }

  private currentDatasetId(): string | null {
    const match = this.router.url.match(/^\/datasets\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}
