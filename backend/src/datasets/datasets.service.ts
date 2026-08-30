import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Dataset, DatasetDocument } from './dataset.schema';
import type { BudgetModel, ColumnMap, LineItem } from '../parser/parser.types';
import type { SessionUser } from '../auth/session.types';
import { CaasService, caasDisplayName } from '../caas/caas.service';

/** Resolved, never persisted: CaaS One id -> how to show that person. */
export type UploaderIndex = Map<string, { name: string; email: string }>;

export interface DatasetSummary {
  id: string;
  fileName: string;
  kind: string;
  sheetName: string;
  deptName: string | null;
  rowCount: number;
  lineCount: number;
  categoryCount: number;
  total: BudgetModel['total'];
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  createdAt?: Date;
}

/** A summary plus the normalized model the dashboard drills through. */
export interface DatasetDetail extends DatasetSummary {
  model: BudgetModel;
}

/** Either a hydrated document or a `.lean()` result. */
type DatasetRecord = Dataset & { _id: unknown };

const CSV_COLUMNS = [
  'Category',
  'Line Item',
  'Row',
  'Consumable',
  'Consumed',
  'Available',
];

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class DatasetsService implements OnModuleInit {
  private readonly logger = new Logger(DatasetsService.name);

  constructor(
    @InjectModel(Dataset.name)
    private readonly model: Model<DatasetDocument>,
    private readonly caas: CaasService,
  ) {}

  /** Drops user names/emails copied into datasets before they were dropped. */
  async onModuleInit(): Promise<void> {
    const res = await this.model.collection.updateMany(
      { $or: [{ uploadedByName: { $exists: true } }, { uploadedByEmail: { $exists: true } }] },
      { $unset: { uploadedByName: '', uploadedByEmail: '' } },
    );
    if (res.modifiedCount) {
      this.logger.log(
        `Removed stored uploader name/email from ${res.modifiedCount} dataset(s) — ` +
          'CaaS One is the only record of users.',
      );
    }
  }

  /**
   * Who uploaded each dataset, resolved live. The viewer's own details come
   * from their session; anyone else needs the CaaS One directory, which only
   * an admin may read — a non-admin simply sees no name rather than a stale one.
   */
  private async uploaderIndex(
    ids: string[],
    token?: string,
    viewer?: SessionUser,
  ): Promise<UploaderIndex> {
    const idx: UploaderIndex = new Map();
    if (viewer?.sub) {
      idx.set(viewer.sub, {
        name: viewer.displayName,
        email: viewer.email,
      });
    }
    const missing = [...new Set(ids)].filter((id) => id && !idx.has(id));
    if (!missing.length || !token) return idx;
    try {
      for (const u of await this.caas.listUsers(token)) {
        idx.set(String(u._id), { name: caasDisplayName(u), email: u.email });
      }
    } catch {
      // Not an admin, or CaaS One is unreachable — names stay unresolved.
    }
    return idx;
  }

  toSummary(d: DatasetRecord, uploaders?: UploaderIndex): DatasetSummary {
    const who = uploaders?.get(d.uploadedBy);
    return {
      id: String(d._id),
      fileName: d.fileName,
      kind: d.kind,
      sheetName: d.sheetName,
      deptName: d.deptName ?? null,
      rowCount: d.rowCount,
      lineCount: d.lineCount,
      categoryCount: (d.cats || []).length,
      total: d.total,
      uploadedByName: who?.name ?? null,
      uploadedByEmail: who?.email ?? null,
      createdAt: d.createdAt,
    };
  }

  /**
   * Rebuilds the parser's `BudgetModel` from the flattened document so the
   * client receives the same shape `inspect` returns.
   */
  toDetail(d: DatasetRecord, uploaders?: UploaderIndex): DatasetDetail {
    return {
      ...this.toSummary(d, uploaders),
      model: {
        fileName: d.fileName,
        kind: d.kind,
        delim: d.delim ?? undefined,
        sheetName: d.sheetName,
        sheetIdx: d.sheetIdx,
        headers: d.headers || [],
        hIdx: d.hIdx,
        map: d.map,
        rowCount: d.rowCount,
        cats: d.cats || [],
        headings: d.headings || [],
        department: d.department ?? null,
        grandRow: d.grandRow ?? null,
        deptName: d.deptName ?? null,
        total: d.total,
        unknown: d.unknown || [],
        findings: d.findings || [],
        lineCount: d.lineCount,
        codeProfile: d.codeProfile ?? undefined,
        skipped: d.skipped || [],
      },
    };
  }

  async list(token?: string, viewer?: SessionUser): Promise<DatasetSummary[]> {
    const docs = (await this.model
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as unknown as DatasetRecord[];
    const uploaders = await this.uploaderIndex(
      docs.map((d) => d.uploadedBy),
      token,
      viewer,
    );
    return docs.map((d) => this.toSummary(d, uploaders));
  }

  async findOne(id: string): Promise<DatasetDocument> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid dataset id: ${id}`);
    }
    const doc = await this.model.findById(id).exec();
    if (!doc) throw new NotFoundException(`Dataset ${id} not found`);
    return doc;
  }

  async getDetail(
    id: string,
    token?: string,
    viewer?: SessionUser,
  ): Promise<DatasetDetail> {
    const doc = await this.findOne(id);
    const record = doc as unknown as DatasetRecord;
    const uploaders = await this.uploaderIndex(
      [record.uploadedBy],
      token,
      viewer,
    );
    return this.toDetail(record, uploaders);
  }

  async remove(id: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid dataset id: ${id}`);
    }
    const result = await this.model.deleteOne({ _id: id }).exec();
    if (!result.deletedCount) {
      throw new NotFoundException(`Dataset ${id} not found`);
    }
  }

  async createFromModel(
    model: BudgetModel,
    user: SessionUser,
  ): Promise<DatasetDetail> {
    const doc = await this.model.create({
      fileName: model.fileName,
      kind: model.kind,
      delim: model.delim ?? null,
      sheetName: model.sheetName,
      sheetIdx: model.sheetIdx,
      headers: model.headers,
      hIdx: model.hIdx,
      map: model.map,
      rowCount: model.rowCount,
      cats: model.cats,
      headings: model.headings,
      department: model.department,
      grandRow: model.grandRow,
      deptName: model.deptName,
      total: model.total,
      unknown: model.unknown,
      findings: model.findings,
      lineCount: model.lineCount,
      codeProfile: model.codeProfile ?? null,
      skipped: model.skipped ?? [],
      uploadedBy: user.sub,
    });
    return this.toDetail(doc, new Map([[user.sub, { name: user.displayName, email: user.email }]]));
  }

  /**
   * Renders one category (or the whole dataset) as CSV.
   * Category totals are emitted as their own row above their line items.
   */
  toCsv(dataset: Dataset, categoryIndex?: number): string {
    const cats = dataset.cats || [];
    let selected = cats;
    if (categoryIndex != null) {
      if (
        !Number.isInteger(categoryIndex) ||
        categoryIndex < 0 ||
        categoryIndex >= cats.length
      ) {
        throw new BadRequestException(
          `Category index ${categoryIndex} is out of range.`,
        );
      }
      selected = [cats[categoryIndex]];
    }

    const lines: string[] = [CSV_COLUMNS.join(',')];
    const push = (cat: string, item: LineItem) =>
      lines.push(
        [
          csvCell(cat),
          csvCell(item.name),
          csvCell(item.row),
          csvCell(item.values.consumable),
          csvCell(item.values.consumed),
          csvCell(item.values.available),
        ].join(','),
      );

    for (const cat of selected) {
      push(cat.name, cat);
      for (const sub of cat.subs || []) push(cat.name, sub);
    }

    if (categoryIndex == null) {
      lines.push(
        [
          csvCell('TOTAL'),
          csvCell(dataset.deptName ?? dataset.fileName),
          '',
          csvCell(dataset.total.consumable),
          csvCell(dataset.total.consumed),
          csvCell(dataset.total.available),
        ].join(','),
      );
    }

    return lines.join('\r\n');
  }

  parseColumnMap(raw: string | undefined): ColumnMap | undefined {
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('`map` must be valid JSON.');
    }
    const keys = ['label', 'consumable', 'consumed', 'available'] as const;
    const obj = parsed as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') {
      throw new BadRequestException('`map` must be a JSON object.');
    }
    const map = {} as ColumnMap;
    for (const key of keys) {
      const n = Number(obj[key]);
      if (!Number.isInteger(n)) {
        throw new BadRequestException(`\`map.${key}\` must be an integer.`);
      }
      map[key] = n;
    }
    return map;
  }
}
