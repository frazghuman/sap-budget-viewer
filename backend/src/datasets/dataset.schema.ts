import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type {
  CategoryNode,
  CodeProfile,
  ColumnMap,
  Finding,
  LineItem,
  MoneyValues,
} from '../parser/parser.types';

export type DatasetDocument = HydratedDocument<Dataset>;

/**
 * Persisted budget dataset. Only the normalized model is stored — the
 * uploaded file bytes are parsed in-memory and discarded.
 */
@Schema({ timestamps: true, collection: 'datasets' })
export class Dataset {
  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  kind: string;

  @Prop({ type: String, default: null })
  delim: string | null;

  @Prop({ required: true })
  sheetName: string;

  @Prop({ type: Number, default: 0 })
  sheetIdx: number;

  @Prop({ type: [String], default: [] })
  headers: string[];

  @Prop({ type: Number, default: 0 })
  hIdx: number;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  map: ColumnMap;

  @Prop({ type: Number, default: 0 })
  rowCount: number;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  cats: CategoryNode[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  headings: LineItem[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  department: LineItem | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  grandRow: LineItem | null;

  @Prop({ type: String, default: null })
  deptName: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  total: MoneyValues;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  unknown: LineItem[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  findings: Finding[];

  @Prop({ type: Number, default: 0 })
  lineCount: number;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  codeProfile: CodeProfile | null;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  skipped: LineItem[];

  /**
   * Secret that makes this dataset readable without a session.
   *
   * Null until someone shares it, and null again the moment they revoke — the
   * public endpoint looks the dataset up *by* this token, so clearing it is a
   * complete revocation rather than a flag some future code path might forget
   * to check. Sparse so the unique index only covers datasets that are
   * actually shared.
   */
  @Prop({ type: String, default: null })
  shareToken: string | null;

  @Prop({ type: Date, default: null })
  sharedAt: Date | null;

  /** CaaS One user id of whoever created the current link. */
  @Prop({ type: String, default: null })
  sharedBy: string | null;

  /**
   * CaaS One user id only. Names and emails are deliberately not stored —
   * CaaS One owns user records, and a copy here would outlive a rename or a
   * deletion. Display names are resolved from CaaS One when a dataset is read.
   */
  @Prop({ required: true, index: true })
  uploadedBy: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DatasetSchema = SchemaFactory.createForClass(Dataset);
DatasetSchema.index({ createdAt: -1 });
DatasetSchema.index({ shareToken: 1 }, { unique: true, sparse: true });
