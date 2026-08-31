import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { BudgetModel, DatasetDetail, DatasetSummary, SessionResponse } from '../../core/models';
import { BrowserNavigator } from '../../core/navigator.service';
import { DashboardComponent } from './dashboard.component';
import { environment } from '../../../environments/environment';

const model: BudgetModel = {
  fileName: 'FMRP.xlsx',
  kind: 'xlsx',
  sheetName: 'Sheet1',
  sheetIdx: 0,
  headers: ['Funds Center', 'Consumable', 'Consumed', 'Available'],
  hIdx: 0,
  map: { label: 0, consumable: 1, consumed: 2, available: 3 },
  rowCount: 4,
  deptName: '151100101 Sui (Prod)',
  department: null,
  grandRow: null,
  headings: [],
  unknown: [],
  findings: [],
  lineCount: 3,
  total: { consumable: 1500, consumed: 470, available: 1030 },
  cats: [
    {
      name: '660 - Repairs',
      row: 2,
      values: { consumable: 500, consumed: 220, available: 280 },
      subs: [
        { name: '900111101 Pipe repair', row: 3, values: { consumable: 100, consumed: 120, available: -20 } },
        { name: '900111102 Valves', row: 4, values: { consumable: 400, consumed: 100, available: 300 } },
      ],
    },
    {
      name: '684 - Insurance',
      row: 5,
      values: { consumable: 1000, consumed: 250, available: 750 },
      subs: [
        { name: '900222201 Fire cover', row: 6, values: { consumable: 1000, consumed: 250, available: 750 } },
      ],
    },
  ],
};

const dataset: DatasetDetail = {
  id: 'ds-1',
  fileName: 'FMRP.xlsx',
  kind: 'xlsx',
  sheetName: 'Sheet1',
  deptName: '151100101 Sui (Prod)',
  rowCount: 4,
  lineCount: 3,
  categoryCount: 2,
  total: model.total,
  uploadedByName: 'Budget Admin',
  uploadedByEmail: 'admin@sui.pk',
  createdAt: '2026-08-01T09:00:00.000Z',
  model,
};

const summary: DatasetSummary = (({ model: _model, ...rest }) => rest)(dataset);

function session(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    authenticated: true,
    user: { sub: 'u', email: 'u@sui.pk', userType: 'staff', displayName: 'User' },
    canView: true,
    canUpload: false,
    canExport: false,
    ...overrides,
  };
}

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let http: HttpTestingController;

  function setUp(s: SessionResponse): void {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BrowserNavigator, useValue: { redirect: () => {}, currentPath: () => '/' } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({})),
            snapshot: { data: {} },
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });

    http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    auth.loadSession().subscribe();
    http.expectOne(`${environment.apiBaseUrl}/auth/session`).flush(s);

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    http.expectOne(`${environment.apiBaseUrl}/datasets`).flush([summary]);
    http.expectOne(`${environment.apiBaseUrl}/datasets/ds-1`).flush(dataset);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('opens on the latest dataset at the department roll-up', () => {
    setUp(session({}));

    expect(component.loading()).toBeFalse();
    expect(component.isRoot()).toBeTrue();
    expect(component.node().name).toBe('151100101 Sui (Prod)');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.hero-v')?.textContent).toContain('1,500');
    expect(el.querySelectorAll('.bar-row').length).toBe(2);
  });

  it('counts overspent commitment items across the whole tree', () => {
    setUp(session({}));

    expect(component.overspentLines()).toBe(1);
  });

  it('drills into a category and returns to the root on Escape', () => {
    setUp(session({}));

    const repairs = component.rows().find((r) => r.name === '660 - Repairs')!;
    component.drillInto(repairs);
    fixture.detectChanges();
    expect(component.isRoot()).toBeFalse();
    expect(component.node().name).toBe('660 - Repairs');
    expect(component.allRows().length).toBe(2);

    component.onEscape();
    fixture.detectChanges();
    expect(component.isRoot()).toBeTrue();
  });

  it('filters rows by the search query', () => {
    setUp(session({}));

    component.onSearch('insurance');
    fixture.detectChanges();
    expect(component.rows().map((r) => r.name)).toEqual(['684 - Insurance']);
  });

  it('hides upload and export controls from a view-only session', () => {
    setUp(session({ canUpload: false, canExport: false }));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('fluent-button').length).toBe(0);
  });

  it('offers export to an administrator without duplicating header actions', () => {
    setUp(session({ canUpload: true, canExport: true }));

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('fluent-button'),
    ).map((b) => b.textContent?.trim());
    expect(labels).toContain('Export CSV');
    expect(labels).not.toContain('New file');
  });
});

/**
 * The `/shared/:token` view. Its whole reason to exist is that it reads through
 * the public endpoint and offers an anonymous visitor nothing else, so that is
 * what these assert: the request that goes out, and the controls that do not
 * come back.
 */
describe('DashboardComponent (shared link)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let http: HttpTestingController;

  /** What the public endpoint actually returns: no uploader, no diagnostics. */
  const publicDataset: DatasetDetail = {
    ...dataset,
    uploadedByName: null,
    uploadedByEmail: null,
    model: { ...model, findings: [], skipped: [], unknown: [] },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BrowserNavigator, useValue: { redirect: () => {}, currentPath: () => '/' } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ token: 'tok-123' })),
            snapshot: { data: { shared: true } },
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('reads through the public endpoint and never lists datasets', () => {
    http
      .expectOne(`${environment.apiBaseUrl}/public/datasets/tok-123`)
      .flush(publicDataset);
    fixture.detectChanges();

    // The signed-in view opens by listing datasets; the shared one must not,
    // because that endpoint requires a session and would 401 an anonymous
    // visitor into an error screen.
    http.expectNone(`${environment.apiBaseUrl}/datasets`);
    expect(component.shared()).toBeTrue();
    expect(component.loading()).toBeFalse();
    expect(component.node().name).toBe('151100101 Sui (Prod)');
  });

  it('shows the view-only badge and no share or export controls', () => {
    http
      .expectOne(`${environment.apiBaseUrl}/public/datasets/tok-123`)
      .flush(publicDataset);
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('View only');
    expect(fixture.nativeElement.querySelector('.share-btn')).toBeNull();
    expect(html).not.toContain('Export CSV');
  });

  it('explains a revoked link rather than showing an empty dashboard', () => {
    http
      .expectOne(`${environment.apiBaseUrl}/public/datasets/tok-123`)
      .flush({ message: 'gone' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(component.error()).toContain('no longer valid');
    expect(component.dataset()).toBeNull();
  });
});
