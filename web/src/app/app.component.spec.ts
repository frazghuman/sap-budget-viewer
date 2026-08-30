import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app.component';
import { ANONYMOUS_SESSION } from './core/models';

describe('AppComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(ANONYMOUS_SESSION);
  });

  it('renders the product brand', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush(ANONYMOUS_SESSION);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.brand-name')?.textContent).toContain('Budget Control');
    expect(el.querySelector('.brand .sub')?.textContent).toContain('Funds Center Analysis');
  });

  it('hides the upload entry point from users without budget:create', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush({
      authenticated: true,
      user: { sub: '1', email: 'v@sui.pk', userType: 'staff', displayName: 'Viewer' },
      canView: true,
      canUpload: false,
      canExport: true,
    });
    fixture.detectChanges();

    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a.tbtn'),
    ).map((a) => a.textContent?.trim());
    expect(links).not.toContain('New file');
  });

  it('opens dataset search from the header and deletes after confirmation', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/auth/session').flush({
      authenticated: true,
      user: { sub: '1', email: 'a@sui.pk', userType: 'staff', displayName: 'Admin' },
      permissions: [
        { featureKey: 'budget', actions: ['view', 'create', 'delete', 'export'] },
      ],
      canView: true,
      canUpload: true,
      canDelete: true,
      canExport: true,
    });
    fixture.detectChanges();

    fixture.componentInstance.openDatasetDialog();
    const request = http.expectOne('/api/datasets');
    request.flush([
      {
        id: 'dataset-1',
        fileName: 'August.xlsx',
        kind: 'xlsx',
        sheetName: 'Budget',
        deptName: 'SUI',
        rowCount: 20,
        lineCount: 10,
        categoryCount: 5,
        total: { consumable: 100, consumed: 20, available: 80 },
        uploadedByName: 'Admin',
        uploadedByEmail: 'a@sui.pk',
        createdAt: '2026-08-30T08:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.dataset-dialog')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.dataset-file')?.textContent).toContain(
      'August.xlsx',
    );

    fixture.componentInstance.confirmDelete(
      fixture.componentInstance.datasets()[0],
      new Event('click'),
    );
    fixture.componentInstance.deleteDataset();
    http.expectOne('/api/datasets/dataset-1').flush({ deleted: true });
    fixture.detectChanges();

    expect(fixture.componentInstance.datasets()).toHaveSize(0);
    expect(fixture.componentInstance.deleteCandidate()).toBeNull();
  });
});
