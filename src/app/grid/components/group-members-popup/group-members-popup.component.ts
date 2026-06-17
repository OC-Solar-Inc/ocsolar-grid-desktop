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
import { GridChannelMember, GridMemberRole } from '../../interfaces/grid.interface';
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

  @Output() close = new EventEmitter<void>();
  @Output() membersChanged = new EventEmitter<void>();
  @Output() replyOnlyToggled = new EventEmitter<void>();
  @Output() groupRenamed = new EventEmitter<string>();
  @Output() groupDeleted = new EventEmitter<void>();

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
        this.members = members;
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
    // Only the group creator (owner) can remove members
    if (!this.isOwner()) return false;

    // Cannot remove yourself via this UI (use Leave)
    if (member.user_id === this.currentUserId) return false;

    // Cannot remove the owner
    if (member.role === 'owner') return false;

    return true;
  }

  /**
   * Check if current user can add members (creator/owner only)
   */
  canAddMembers(): boolean {
    return this.isOwner();
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
   * Check if current user is the group owner
   */
  isOwner(): boolean {
    return this.currentUserRole === 'owner';
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
    if (!this.isOwner()) return;
    this.replyOnlyToggled.emit();
  }

  /**
   * Close the popup
   */
  onClose(): void {
    this.close.emit();
  }
}
