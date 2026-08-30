import { HttpClient, HttpEvent, HttpRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ColumnMap, DatasetDetail, DatasetSummary, InspectResult } from './models';

@Injectable({ providedIn: 'root' })
export class BudgetApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listDatasets(): Observable<DatasetSummary[]> {
    return this.http
      .get<DatasetSummary[] | { items: DatasetSummary[] }>(`${this.base}/datasets`)
      .pipe(map((res) => (Array.isArray(res) ? res : (res?.items ?? []))));
  }

  getDataset(id: string): Observable<DatasetDetail> {
    return this.http.get<DatasetDetail>(`${this.base}/datasets/${encodeURIComponent(id)}`);
  }

  deleteDataset(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `${this.base}/datasets/${encodeURIComponent(id)}`,
    );
  }

  /** Parses and validates without persisting. Emits upload progress events. */
  inspectFile(form: FormData): Observable<HttpEvent<InspectResult>> {
    return this.http.request(
      new HttpRequest<FormData>('POST', `${this.base}/datasets/inspect`, form, {
        reportProgress: true,
        withCredentials: true,
      }),
    ) as Observable<HttpEvent<InspectResult>>;
  }

  /** Persists the parsed dataset. Requires `budget:create`. */
  importFile(form: FormData): Observable<HttpEvent<DatasetDetail>> {
    return this.http.request(
      new HttpRequest<FormData>('POST', `${this.base}/datasets/import`, form, {
        reportProgress: true,
        withCredentials: true,
      }),
    ) as Observable<HttpEvent<DatasetDetail>>;
  }

  exportCsv(id: string, categoryIndex?: number): Observable<Blob> {
    const params: Record<string, string> = {};
    if (categoryIndex != null && categoryIndex >= 0) {
      params['categoryIndex'] = String(categoryIndex);
    }
    return this.http.get(`${this.base}/datasets/${encodeURIComponent(id)}/export`, {
      params,
      responseType: 'blob',
    });
  }

  /** The multipart body the inspect and import endpoints both expect. */
  buildForm(file: File, sheetIdx?: number, map?: ColumnMap): FormData {
    const form = new FormData();
    form.append('file', file, file.name);
    if (sheetIdx != null) form.append('sheetIdx', String(sheetIdx));
    if (map) form.append('map', JSON.stringify(map));
    return form;
  }
}
