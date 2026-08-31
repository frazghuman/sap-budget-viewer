import { Controller, Get, Param } from '@nestjs/common';
import { DatasetsService } from './datasets.service';

/**
 * The read-only, unauthenticated view of a shared dataset.
 *
 * A separate controller on purpose: `DatasetsController` carries
 * `@UseGuards(SessionAuthGuard, PermissionGuard)` at the class level, and the
 * safe way to have one public route among authenticated ones is not to poke a
 * hole in that guard — it is to keep the public surface somewhere it cannot be
 * widened by accident. Everything reachable here is intended to be world
 * readable by whoever holds the link.
 */
@Controller('public/datasets')
export class PublicDatasetsController {
  constructor(private readonly datasets: DatasetsService) {}

  /**
   * No id is accepted here, only the share token — so holding a dataset id
   * (which the signed-in app exposes freely) grants nothing, and the only way
   * in is a secret that an authorised user chose to hand out.
   */
  @Get(':token')
  get(@Param('token') token: string) {
    return this.datasets.getSharedDetail(token);
  }
}
