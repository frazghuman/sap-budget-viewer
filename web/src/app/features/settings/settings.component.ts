import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { InvitationsService } from '../../core/invitations.service';
import { AppMember, AppRole } from '../../core/models';
import { initialsOf } from '../../core/format';

interface InviteForm {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

const EMPTY_INVITE: InviteForm = { email: '', firstName: '', lastName: '', roleId: '' };

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnDestroy {
  private readonly api = inject(InvitationsService);
  private readonly destroy$ = new Subject<void>();
  readonly auth = inject(AuthService);

  readonly members = signal<AppMember[]>([]);
  readonly roles = signal<AppRole[]>([]);
  readonly rolesDerived = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly query = signal('');

  readonly inviteOpen = signal(false);
  readonly invite = signal<InviteForm>({ ...EMPTY_INVITE });
  readonly inviting = signal(false);

  /** Row whose action menu is open, by assignment id. */
  readonly menuFor = signal<string | null>(null);
  readonly busyRow = signal<string | null>(null);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const rows = this.members();
    if (!q) return rows;
    return rows.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.roleName.toLowerCase().includes(q),
    );
  });

  readonly pendingCount = computed(
    () => this.members().filter((m) => m.status === 'pending').length,
  );

  readonly canSubmitInvite = computed(() => {
    const f = this.invite();
    return (
      !this.inviting() &&
      /\S+@\S+\.\S+/.test(f.email.trim()) &&
      !!f.firstName.trim() &&
      !!f.lastName.trim() &&
      !!f.roleId
    );
  });

  constructor() {
    this.reload();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  initials(m: { name: string; email: string }): string {
    return initialsOf(m.name || m.email);
  }

  reload(): void {
    this.loading.set(true);
    this.api
      .load()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.members.set(data.members ?? []);
          this.roles.set(data.roles ?? []);
          this.rolesDerived.set(data.rolesDerived === true);
          this.error.set(null);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(this.messageOf(e));
          this.loading.set(false);
        },
      });
  }

  openInvite(): void {
    this.invite.set({ ...EMPTY_INVITE, roleId: this.roles()[0]?.id ?? '' });
    this.error.set(null);
    this.inviteOpen.set(true);
  }

  closeInvite(): void {
    this.inviteOpen.set(false);
    this.inviting.set(false);
  }

  patchInvite(patch: Partial<InviteForm>): void {
    this.invite.set({ ...this.invite(), ...patch });
  }

  submitInvite(): void {
    if (!this.canSubmitInvite()) return;
    const f = this.invite();
    this.inviting.set(true);
    this.api
      .invite({
        email: f.email.trim(),
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        roleId: f.roleId,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.inviting.set(false);
          this.inviteOpen.set(false);
          this.flash(`Invitation sent to ${f.email.trim()}.`);
        },
        error: (e) => {
          this.error.set(this.messageOf(e));
          this.inviting.set(false);
        },
      });
  }

  toggleMenu(id: string, event: Event): void {
    // Kept from the document handler below, which would close it again.
    event.stopPropagation();
    this.menuFor.set(this.menuFor() === id ? null : id);
  }

  closeMenu(): void {
    this.menuFor.set(null);
  }

  /** A click anywhere else dismisses an open row menu. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.menuFor()) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuFor()) this.closeMenu();
    else if (this.inviteOpen()) this.closeInvite();
  }

  changeRole(m: AppMember, roleId: string): void {
    if (!roleId || roleId === m.roleId) return;
    this.busyRow.set(m.assignmentId);
    this.api
      .changeRole(m.userId, roleId, m.assignmentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.busyRow.set(null);
          this.flash(`${m.name} is now ${this.roleName(roleId)}.`);
        },
        error: (e) => this.fail(e),
      });
  }

  resend(m: AppMember): void {
    this.closeMenu();
    this.busyRow.set(m.assignmentId);
    this.api
      .resend(m.userId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.busyRow.set(null);
          this.flash(`Invitation re-sent to ${m.email}.`);
        },
        error: (e) => this.fail(e),
      });
  }

  copyLink(m: AppMember): void {
    this.closeMenu();
    this.busyRow.set(m.assignmentId);
    this.api
      .inviteLink(m.userId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: async (res) => {
          this.busyRow.set(null);
          if (!res.link) {
            this.error.set('CaaS One did not return an invite link.');
            return;
          }
          try {
            await navigator.clipboard.writeText(res.link);
            this.flash('Invite link copied to the clipboard.');
          } catch {
            // Clipboard access is denied outside a secure context — show the
            // link so it can still be copied by hand.
            this.flash(res.link);
          }
        },
        error: (e) => this.fail(e),
      });
  }

  revoke(m: AppMember): void {
    this.closeMenu();
    const ok = confirm(
      `Remove ${m.name}'s access to Budget Control?\n\n` +
        'Their CaaS One account and access to other apps are unaffected.',
    );
    if (!ok) return;
    this.busyRow.set(m.assignmentId);
    this.api
      .revoke(m.assignmentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (members) => {
          this.members.set(members);
          this.busyRow.set(null);
          this.flash(`${m.name} no longer has access.`);
        },
        error: (e) => this.fail(e),
      });
  }

  private roleName(id: string): string {
    return this.roles().find((r) => r.id === id)?.name ?? 'updated';
  }

  private fail(e: unknown): void {
    this.busyRow.set(null);
    this.error.set(this.messageOf(e));
  }

  private flash(message: string): void {
    this.error.set(null);
    this.notice.set(message);
    setTimeout(() => {
      if (this.notice() === message) this.notice.set(null);
    }, 6000);
  }

  private messageOf(e: unknown): string {
    const err = e as { error?: { message?: string }; status?: number };
    if (err?.error?.message) return err.error.message;
    if (err?.status === 403) return 'You do not have rights to manage users here.';
    return 'Something went wrong talking to CaaS One.';
  }
}
