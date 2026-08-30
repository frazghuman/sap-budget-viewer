import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DatasetsService } from './datasets.service';
import { ParserService } from '../parser/parser.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../common/permission.guard';
import { RequirePermission } from '../common/permission.decorator';
import type { SessionUser } from '../auth/session.types';
import type { InspectResult } from '../parser/parser.types';
import type { AuthedRequest } from '../auth/authed-request';

const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024;
const UPLOAD_OPTIONS = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

interface UploadBody {
  sheetIdx?: string;
  map?: string;
}

@Controller('datasets')
@UseGuards(SessionAuthGuard, PermissionGuard)
export class DatasetsController {
  constructor(
    private readonly datasets: DatasetsService,
    private readonly parser: ParserService,
  ) {}

  private requireFile(file?: Express.Multer.File): Express.Multer.File {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A budget file is required.');
    }
    return file;
  }

  private parseSheetIdx(raw: string | undefined, fallback = 0): number {
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new BadRequestException(
        '`sheetIdx` must be a non-negative integer.',
      );
    }
    return n;
  }

  @Get()
  @RequirePermission('budget', 'view')
  list(@Req() req: AuthedRequest, @CurrentUser() user: SessionUser) {
    return this.datasets.list(req.caasToken, user);
  }

  @Get(':id')
  @RequirePermission('budget', 'view')
  findOne(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
  ) {
    return this.datasets.getDetail(id, req.caasToken, user);
  }

  @Delete(':id')
  @RequirePermission('budget', 'delete')
  async remove(@Param('id') id: string) {
    await this.datasets.remove(id);
    return { deleted: true };
  }

  @Get(':id/export')
  @RequirePermission('budget', 'export')
  async export(
    @Param('id') id: string,
    @Query('categoryIndex') categoryIndex: string | undefined,
    @Res() res: import('express').Response,
  ): Promise<void> {
    const doc = await this.datasets.findOne(id);
    const index =
      categoryIndex == null || categoryIndex === ''
        ? undefined
        : Number(categoryIndex);
    if (index != null && !Number.isInteger(index)) {
      throw new BadRequestException('`categoryIndex` must be an integer.');
    }

    const csv = this.datasets.toCsv(doc, index);
    const base = doc.fileName.replace(/\.[^.]+$/, '') || 'budget';
    const suffix = index == null ? 'all' : `category-${index}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${base}-${suffix}.csv"`,
    );
    res.send('\uFEFF' + csv);
  }

  @Post('inspect')
  @RequirePermission('budget', 'create')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  inspect(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadBody,
  ): InspectResult {
    const upload = this.requireFile(file);
    return this.parser.inspect(
      upload.buffer,
      upload.originalname,
      this.parseSheetIdx(body?.sheetIdx),
      this.datasets.parseColumnMap(body?.map),
    );
  }

  @Post('import')
  @RequirePermission('budget', 'create')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadBody,
    @CurrentUser() user: SessionUser,
  ) {
    const upload = this.requireFile(file);
    const map = this.datasets.parseColumnMap(body?.map);
    if (!map) {
      throw new BadRequestException(
        '`map` is required — inspect the file first, then import with the confirmed column map.',
      );
    }
    const model = this.parser.importModel(
      upload.buffer,
      upload.originalname,
      this.parseSheetIdx(body?.sheetIdx),
      map,
    );
    return this.datasets.createFromModel(model, user);
  }
}
