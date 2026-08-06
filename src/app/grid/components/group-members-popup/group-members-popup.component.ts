import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GridApiService } from '../../services/grid-api.service';
import { GridChannelMember, GridMemberRole, GridPostingPermission } from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

@Component({
  selector: 'lib-group-members-popup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  templateUrl: './group-members-popup.component.html',
  styleUrls: ['./group-members-popup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupMembersPopupComponent implements OnInit {
  @Input() channelId!: string;
  @Input() channelName: string = '';
  @Input() users: User[] = [];
  @Input() userMap = new Map<string, User>();
  @Input() currentUserId: string | null = null;
  @Input() isReplyOnly = false;
  @Input() channelOwnerId: string = '';

  @Output() close = new EventEmitter<void>();
  @Output() membersChanged = new EventEmitter<void>();
  @Output() replyOnlyToggled = new EventEmitter<void>();
  @Output() groupRenamed = new EventEmitter<string>();
  @Output() groupDeleted = new EventEmitter<void>();
  @Output() postingPermissionsChanged = new EventEmitter<void>();
  @Output() ownershipTransferred = new EventEmitter<string>();

  members: GridChannelMember[] = [];
  isLoading = true;
  isAddingMembers = false;
  searchQuery = '';
  selectedUserIds: Set<string> = new Set();
  isSubmitting = false;
  currentUserRole: GridMemberRole | null = null;

  // Rename state
  isEditingName = false;
  editableName = '';
  isRenaming = false;
  isDeleting = false;
  updatingPermissionFor = new Set<string>();
  updatingRoleFor = new Set<string>();
  transferringOwnershipTo: string | null = null;

  constructor(
    private gridApi: GridApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadMembers();
  }

  /**
   * Load channel members
   */
  loadMembers(): void {
    this.isLoading = true;
    this.gridApi.getChannelMembers(this.channelId).subscribe({
      next: (members) => {
        this.members = members.map(member => ({
          ...member,
          posting_permission: member.role === 'owner'
            ? 'can_post'
            : (member.posting_permission || 'can_post'),
        }));
        // Find current user's role
        const currentMember = members.find(m => m.user_id === this.currentUserId);
        this.currentUserRole = currentMember?.role || null;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error loading members:', error);
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Get display name for a member
   */
  getMemberDisplayName(member: GridChannelMember): string {
    const user = this.userMap.get(member.user_id);
    if (user) {
      return user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User';
    }
    return member.display_name || member.username || 'Unknown User';
  }

  /**
   * Get user initials for avatar placeholder
   */
  getMemberInitials(member: GridChannelMember): string {
    const name = this.getMemberDisplayName(member);
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Get avatar URL for a member
   */
  getMemberAvatarUrl(member: GridChannelMember): string | undefined {
    const user = this.userMap.get(member.user_id);
    return user?.profileImage || member.avatar_url;
  }

  /**
   * Get role badge color
   */
  getRoleBadgeClass(role: GridMemberRole): string {
    switch (role) {
      case 'owner':
        return 'role-owner';
      case 'admin':
        return 'role-admin';
      default:
        return 'role-member';
    }
  }

  /**
   * Check if current user can remove a member
   */
  canRemoveMember(member: GridChannelMember): boolean {
    // Cannot remove yourself via this UI (use Leave)
    if (member.user_id === this.currentUserId) return false;

    // Cannot remove the owner
    if (member.role === 'owner') return false;

    // Owners can remove admins or members. Admins can remove regular members.
    return this.isOwner() || (this.isAdmin() && member.role === 'member');
  }

  /**
   * Check if current user can add members
   */
  canAddMembers(): boolean {
    return this.isOwner() || this.isAdmin();
  }

  canManagePostingPermission(member: GridChannelMember): boolean {
    if (member.role === 'owner') return false;
    if (this.isOwner()) return true;
    return this.isAdmin() && member.role === 'member';
  }

  isUpdatingPostingPermission(member: GridChannelMember): boolean {
    return this.updatingPermissionFor.has(member.user_id);
  }

  getPostingPermissionLabel(member: GridChannelMember): string {
    if (member.role === 'owner') return 'Owner · can post';
    return member.posting_permission === 'read_only' ? 'Read-only' : 'Can post';
  }

  onPostingPermissionChange(member: GridChannelMember, value: string): void {
    if (!this.canManagePostingPermission(member) || this.isUpdatingPostingPermission(member)) return;
    const postingPermission: GridPostingPermission = value === 'read_only' ? 'read_only' : 'can_post';
    const previous = member.posting_permission || 'can_post';
    if (previous === postingPermission) return;

    this.updatingPermissionFor.add(member.user_id);
    this.members = this.members.map(item =>
      item.user_id === member.user_id ? { ...item, posting_permission: postingPermission } : item
    );
    this.cdr.markForCheck();

    this.gridApi.updateMemberPostingPermission(this.channelId, member.user_id, postingPermission).subscribe({
      next: (updatedMember) => {
        this.members = this.members.map(item =>
          item.user_id === member.user_id
            ? { ...item, ...updatedMember, posting_permission: updatedMember.posting_permission || postingPermission }
            : item
        );
        this.updatingPermissionFor.delete(member.user_id);
        this.postingPermissionsChanged.emit();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error updating member posting permission:', error);
        this.members = this.members.map(item =>
          item.user_id === member.user_id ? { ...item, posting_permission: previous } : item
        );
        this.updatingPermissionFor.delete(member.user_id);
        this.cdr.markForCheck();
      },
    });
  }

  canManageRole(member: GridChannelMember): boolean {
    return this.isOwner()
      && member.role !== 'owner'
      && member.user_id !== this.currentUserId;
  }

  isUpdatingRole(member: GridChannelMember): boolean {
    return this.updatingRoleFor.has(member.user_id);
  }

  onMemberRoleChange(member: GridChannelMember, value: string): void {
    if (!this.canManageRole(member) || this.isUpdatingRole(member)) return;
    const role: 'admin' | 'member' = value === 'admin' ? 'admin' : 'member';
    const previousRole = member.role;
    if (previousRole === role) return;

    this.updatingRoleFor.add(member.user_id);
    this.members = this.members.map(item =>
      item.user_id === member.user_id ? { ...item, role } : item
    );
    this.cdr.markForCheck();

    this.gridApi.updateGroupMemberRole(this.channelId, member.user_id, role).subscribe({
      next: (updatedMember) => {
        this.members = this.members.map(item =>
          item.user_id === member.user_id ? { ...item, ...updatedMember, role } : item
        );
        this.updatingRoleFor.delete(member.user_id);
        this.membersChanged.emit();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error updating group member role:', error);
        this.members = this.members.map(item =>
          item.user_id === member.user_id ? { ...item, role: previousRole } : item
        );
        this.updatingRoleFor.delete(member.user_id);
        this.cdr.markForCheck();
      },
    });
  }

  canTransferOwnership(member: GridChannelMember): boolean {
    return this.isOwner()
      && member.role !== 'owner'
      && member.user_id !== this.currentUserId
      && !this.transferringOwnershipTo;
  }

  transferOwnership(member: GridChannelMember): void {
    if (!this.canTransferOwnership(member)) return;
    const newOwnerName = this.getMemberDisplayName(member);
    const confirmed = window.confirm(
      `Transfer ownership of "${this.channelName || 'this group'}" to ${newOwnerName}? You will become an admin and only the new owner can transfer ownership again.`
    );
    if (!confirmed) return;

    this.transferringOwnershipTo = member.user_id;
    this.cdr.markForCheck();
    this.gridApi.transferGroupOwnership(this.channelId, member.user_id).subscribe({
      next: (response) => {
        const previousOwnerId = this.currentUserId;
        this.channelOwnerId = member.user_id;
        this.members = this.members.map(item => {
          if (item.user_id === member.user_id) {
            return { ...item, ...response.new_owner, role: 'owner', posting_permission: 'can_post' };
          }
          if (item.user_id === previousOwnerId) {
            return { ...item, ...response.previous_owner, role: 'admin', posting_permission: 'can_post' };
          }
          return item;
        });
        this.currentUserRole = 'admin';
        this.transferringOwnershipTo = null;
        this.ownershipTransferred.emit(member.user_id);
        this.membersChanged.emit();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error transferring group ownership:', error);
        this.transferringOwnershipTo = null;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Remove a member from the group
   */
  removeMember(member: GridChannelMember): void {
    if (!this.canRemoveMember(member)) return;

    this.gridApi.removeChannelMembers(this.channelId, [member.user_id]).subscribe({
      next: (response) => {
        if (response.removed.length > 0) {
          this.members = this.members.filter(m => m.user_id !== member.user_id);
          this.membersChanged.emit();
          this.cdr.markForCheck();
        }
        if (response.errors.length > 0) {
          console.error('Error removing member:', response.errors);
        }
      },
      error: (error) => {
        console.error('Error removing member:', error);
      },
    });
  }

  /**
   * Toggle add members section
   */
  toggleAddMembers(): void {
    this.isAddingMembers = !this.isAddingMembers;
    if (!this.isAddingMembers) {
      this.searchQuery = '';
      this.selectedUserIds.clear();
    }
    this.cdr.markForCheck();
  }

  /**
   * Get filtered users for adding (not already members)
   * Uses channel-list's filteredUsersForGroup (already excludes customers + current user)
   * Only need to exclude existing members and apply local search
   */
  get filteredUsersForAdd(): User[] {
    const memberIds = new Set(this.members.map(m => m.user_id));

    // users input is already filtered by channel-list (no customers, no current user)
    let filtered = this.users.filter(user => {
      if (!user.id) return false;
      // Only exclude existing members
      return !memberIds.has(user.id);
    });

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(user => {
        const fullName = user.sFullName || `${user.sFirstName} ${user.sLastName}`;
        return (
          fullName.toLowerCase().includes(query) ||
          user.sEmail?.toLowerCase().includes(query)
        );
      });
    }

    return filtered;
  }

  /**
   * Toggle user selection for adding
   */
  toggleUserSelection(userId: string): void {
    if (this.selectedUserIds.has(userId)) {
      this.selectedUserIds.delete(userId);
    } else {
      this.selectedUserIds.add(userId);
    }
    this.cdr.markForCheck();
  }

  /**
   * Check if a user is selected
   */
  isUserSelected(userId: string): boolean {
    return this.selectedUserIds.has(userId);
  }

  /**
   * Get display name for a user
   */
  getUserDisplayName(user: User): string {
    return user.sFullName || `${user.sFirstName} ${user.sLastName}`.trim() || 'Unknown User';
  }

  /**
   * Get user initials
   */
  getUserInitials(user: User): string {
    const name = this.getUserDisplayName(user);
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Add selected users to the group
   */
  addSelectedMembers(): void {
    if (this.selectedUserIds.size === 0 || this.isSubmitting) return;

    this.isSubmitting = true;
    const userIds = Array.from(this.selectedUserIds);

    this.gridApi.addChannelMembers(this.channelId, userIds).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.isAddingMembers = false;
        this.selectedUserIds.clear();
        this.searchQuery = '';
        this.loadMembers();
        this.membersChanged.emit();
      },
      error: (error) => {
        console.error('Error adding members:', error);
        this.isSubmitting = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Check if current user is the channel owner
   */
  isOwner(): boolean {
    return !!this.currentUserId && this.currentUserId === this.channelOwnerId;
  }

  isAdmin(): boolean {
    return this.currentUserRole === 'admin';
  }

  /**
   * Begin editing the group name (owner only)
   */
  startRename(): void {
    if (!this.isOwner()) return;
    this.editableName = this.channelName;
    this.isEditingName = true;
    this.cdr.markForCheck();
  }

  /**
   * Cancel renaming
   */
  cancelRename(): void {
    this.isEditingName = false;
    this.editableName = '';
    this.cdr.markForCheck();
  }

  /**
   * Save the new group name (owner only)
   */
  saveRename(): void {
    if (!this.isOwner() || this.isRenaming) return;
    const name = this.editableName.trim();
    if (!name || name === this.channelName) {
      this.cancelRename();
      return;
    }

    this.isRenaming = true;
    this.gridApi.renameGroup(this.channelId, name).subscribe({
      next: (channel) => {
        this.channelName = channel?.name || name;
        this.isRenaming = false;
        this.isEditingName = false;
        this.groupRenamed.emit(this.channelName);
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error renaming group:', error);
        this.isRenaming = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Delete the group (owner only), after confirmation
   */
  confirmDelete(): void {
    if (!this.isOwner() || this.isDeleting) return;
    const confirmed = window.confirm(
      `Delete "${this.channelName || 'this group'}"? This permanently removes the group and its messages for everyone.`
    );
    if (!confirmed) return;

    this.isDeleting = true;
    this.gridApi.deleteGroup(this.channelId).subscribe({
      next: () => {
        this.isDeleting = false;
        this.groupDeleted.emit();
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Error deleting group:', error);
        this.isDeleting = false;
        this.cdr.markForCheck();
      },
    });
  }

  /**
   * Toggle reply-only mode (owner only)
   */
  onToggleReplyOnly(): void {
    this.isReplyOnly = !this.isReplyOnly;
    this.replyOnlyToggled.emit();
    this.cdr.markForCheck();
  }

  /**
   * Close the popup
   */
  onClose(): void {
    this.close.emit();
  }
}
