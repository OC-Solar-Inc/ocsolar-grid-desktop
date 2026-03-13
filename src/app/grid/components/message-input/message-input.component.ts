import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  OnDestroy,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { GridFileUploadService } from '../../services/grid-file-upload.service';
import { GridDraftService } from '../../services/grid-draft.service';
import { GridMentionService, MentionSuggestion } from '../../services/grid-mention.service';
import { GridGifService, GiphyGif } from '../../services/grid-gif.service';
import {
  GridMessageAttachment,
  GridFileUploadProgress,
  GridChannel,
} from '../../interfaces/grid.interface';
import { User } from '../../interfaces/user';

export interface MessageSendEvent {
  content: string;
  attachmentIds: string[];
}

export interface EmojiCategory {
  name: string;
  icon: string;
  emojis: string[];
}

// Emoji data organized by category
export const EMOJI_DATA: EmojiCategory[] = [
  {
    name: 'Smileys & People',
    icon: '😊',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋',
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐',
      '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌',
      '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧',
      '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓',
      '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺',
      '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '👍',
      '👎', '👏', '🙌', '👐', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘',
      '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚',
      '🖐️', '🖖', '👋', '🤙', '💪', '🦾', '🖕', '✍️', '🤳', '💅'
    ]
  },
  {
    name: 'Animals & Nature',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨',
      '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒',
      '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇',
      '🐺', '🐗', '🐴', '🦄', '🐝', '🪲', '🐛', '🦋', '🐌', '🐞',
      '🐜', '🪰', '🪱', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎',
      '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟',
      '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧',
      '🌸', '🌷', '🌹', '🥀', '🌺', '🌻', '🌼', '🌱', '🌲', '🌳',
      '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🍄'
    ]
  },
  {
    name: 'Food & Drink',
    icon: '🍕',
    emojis: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈',
      '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦',
      '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠',
      '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞',
      '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕',
      '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕',
      '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙',
      '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦',
      '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩',
      '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃',
      '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹'
    ]
  },
  {
    name: 'Activities',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
      '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳',
      '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷',
      '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️',
      '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗',
      '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️', '🏵️',
      '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧',
      '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻',
      '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩', '🪄', '🎴', '🀄'
    ]
  },
  {
    name: 'Travel & Places',
    icon: '✈️',
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐',
      '🛻', '🚚', '🚛', '🚜', '🛵', '🏍️', '🛺', '🚲', '🛴', '🚏',
      '🛣️', '🛤️', '🛢️', '⛽', '🚨', '🚥', '🚦', '🛑', '🚧', '⚓',
      '⛵', '🛶', '🚤', '🛳️', '⛴️', '🛥️', '🚢', '✈️', '🛩️', '🛫',
      '🛬', '🪂', '💺', '🚁', '🚟', '🚠', '🚡', '🛰️', '🚀', '🛸',
      '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏢', '🏣', '🏤', '🏥', '🏦',
      '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼',
      '🗽', '⛪', '🕌', '🛕', '🕍', '⛩️', '🕋', '⛲', '⛺', '🌁',
      '🌃', '🏙️', '🌄', '🌅', '🌆', '🌇', '🌉', '🎠', '🎡', '🎢',
      '🏖️', '🏝️', '🏜️', '🌋', '🗻', '🏔️', '⛰️', '🏕️', '🗺️', '🧭'
    ]
  },
  {
    name: 'Objects',
    icon: '💡',
    emojis: [
      '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '💽',
      '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️',
      '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭',
      '⏱️', '⏲️', '⏰', '🕰️', '⏳', '⌛', '📡', '🔋', '🔌', '💡',
      '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙',
      '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️',
      '🔩', '⚙️', '🗜️', '⚗️', '🧪', '🧫', '🧬', '🔬', '🔭', '📡',
      '💉', '🩸', '💊', '🩹', '🩺', '🚪', '🛏️', '🛋️', '🪑', '🚽',
      '🪠', '🚿', '🛁', '🪤', '🪒', '🧴', '🧷', '🧹', '🧺', '🧻',
      '🪣', '🧼', '🪥', '🧽', '🧯', '🛒', '🚬', '⚰️', '🪦', '⚱️'
    ]
  },
  {
    name: 'Symbols',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
      '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
      '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐',
      '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳',
      '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️',
      '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️',
      '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️',
      '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓',
      '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️',
      '✅', '☑️', '✔️', '❎', '➕', '➖', '➗', '➰', '➿', '〰️',
      '©️', '®️', '™️', '🔙', '🔚', '🔛', '🔜', '🔝', '🔀', '🔁'
    ]
  }
];

@Component({
  selector: 'lib-message-input',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './message-input.component.html',
  styleUrls: ['./message-input.component.scss'],
})
export class MessageInputComponent implements OnInit, OnChanges, OnDestroy {
  @Input() channelId = '';
  @Input() channelName = '';
  @Input() disabled = false;
  @Input() placeholder?: string;
  @Input() userMap: Map<string, User> = new Map();
  @Input() channel: GridChannel | null = null;

  @Output() messageSent = new EventEmitter<MessageSendEvent>();
  @Output() typingStarted = new EventEmitter<void>();
  @Output() typingStopped = new EventEmitter<void>();

  @ViewChild('textarea') textareaRef!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  messageContent = '';
  isTyping = false;

  // File upload state
  pendingUploads: GridFileUploadProgress[] = [];
  completedAttachments: GridMessageAttachment[] = [];

  // Drag-and-drop state
  isDragOver = false;
  private dragCounter = 0;

  // Mention autocomplete state
  showMentionDropdown = false;
  mentionSuggestions: MentionSuggestion[] = [];
  selectedMentionIndex = 0;
  mentionStartIndex = 0;
  mentionQuery = '';
  // Map display names to user IDs for converting mentions on send
  mentionMap = new Map<string, string>();

  // Emoji picker state
  showEmojiPicker = false;
  emojiCategories = EMOJI_DATA;
  selectedEmojiCategoryIndex = 0;

  // GIF picker state
  showGifPicker = false;
  gifSearchQuery = '';
  gifResults: GiphyGif[] = [];
  trendingGifs: GiphyGif[] = [];
  isLoadingGifs = false;
  gifSearchError = false;
  private gifSearchSubject = new Subject<string>();

  private typingSubject = new Subject<void>();
  private typingStopSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  private uploadSubscriptions: Subscription[] = [];
  private draftSaveSubject = new Subject<void>();
  private isRestoringDraft = false;

  constructor(
    public fileUploadService: GridFileUploadService,
    private draftService: GridDraftService,
    private mentionService: GridMentionService,
    private gifService: GridGifService
  ) {
    // Debounce typing stop events
    this.typingStopSubject
      .pipe(debounceTime(2000), takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.isTyping) {
          this.isTyping = false;
          this.typingStopped.emit();
        }
      });

    // Debounce draft saving (500ms delay)
    this.draftSaveSubject
      .pipe(debounceTime(500), takeUntil(this.destroy$))
      .subscribe(() => {
        this.saveDraft();
      });

    // Debounce GIF search (300ms delay)
    this.gifSearchSubject
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((query) => {
        this.performGifSearch(query);
      });
  }

  ngOnInit(): void {
    // Restore draft for initial channel
    if (this.channelId) {
      this.restoreDraft(this.channelId);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Handle channel changes
    if (changes['channelId'] && !changes['channelId'].firstChange) {
      const previousChannelId = changes['channelId'].previousValue;
      const currentChannelId = changes['channelId'].currentValue;

      // Save draft for the previous channel before switching
      if (previousChannelId && previousChannelId !== currentChannelId) {
        this.saveDraftForChannel(
          previousChannelId,
          this.messageContent,
          this.completedAttachments
        );
      }

      // Restore draft for the new channel
      if (currentChannelId) {
        this.restoreDraft(currentChannelId);
      }

      // Close mention dropdown and clear mention map on channel change
      this.closeMentionDropdown();
      this.mentionMap.clear();
    }

    // Load mention members when userMap, channelId, or channel changes
    if ((changes['userMap'] || changes['channelId'] || changes['channel']) && this.channelId && this.userMap.size > 0) {
      this.mentionService.loadChannelMembers(this.channelId, this.userMap, this.channel);
    }
  }

  ngOnDestroy(): void {
    // Save draft before component is destroyed (navigating away from Grid)
    if (this.channelId && !this.isRestoringDraft) {
      this.draftService.saveDraft(
        this.channelId,
        this.messageContent,
        this.completedAttachments
      );
    }

    this.destroy$.next();
    this.destroy$.complete();

    // Clean up upload subscriptions
    this.uploadSubscriptions.forEach((sub) => sub.unsubscribe());

    // Ensure typing is stopped when component is destroyed
    if (this.isTyping) {
      this.typingStopped.emit();
    }
  }

  get inputPlaceholder(): string {
    return this.placeholder || `Message #${this.channelName}`;
  }

  get isUploading(): boolean {
    return this.pendingUploads.some((u) => u.status === 'uploading');
  }

  get canSend(): boolean {
    const hasContent = this.messageContent.trim().length > 0;
    const hasAttachments = this.completedAttachments.length > 0;
    return (hasContent || hasAttachments) && !this.disabled && !this.isUploading;
  }

  get acceptedFileTypes(): string {
    return this.fileUploadService.getAllowedExtensions();
  }

  onInput(): void {
    this.adjustTextareaHeight();

    // Handle typing indicator
    if (this.messageContent.trim()) {
      if (!this.isTyping) {
        this.isTyping = true;
        this.typingStarted.emit();
      }
      // Reset typing stop timer
      this.typingStopSubject.next();
    } else {
      // Stop typing if content is empty
      if (this.isTyping) {
        this.isTyping = false;
        this.typingStopped.emit();
      }
    }

    // Detect mention trigger
    this.detectMentionTrigger();

    // Trigger draft save (debounced)
    this.triggerDraftSave();
  }

  onKeyDown(event: KeyboardEvent): void {
    // Handle mention dropdown navigation
    if (this.showMentionDropdown && this.mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedMentionIndex = (this.selectedMentionIndex + 1) % this.mentionSuggestions.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedMentionIndex = this.selectedMentionIndex === 0
          ? this.mentionSuggestions.length - 1
          : this.selectedMentionIndex - 1;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.selectMention(this.mentionSuggestions[this.selectedMentionIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMentionDropdown();
        return;
      }
    }

    // Send on Enter (without Shift)
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  sendMessage(): void {
    if (!this.canSend) return;

    // Convert display-format mentions (@[Name]) to backend format (<@userId>)
    const contentWithMentions = this.mentionService.convertMentionsForSend(
      this.messageContent.trim(),
      this.mentionMap
    );

    // Collect attachment IDs
    const attachmentIds = this.completedAttachments.map((a) => a.id);

    this.messageSent.emit({ content: contentWithMentions, attachmentIds });

    // Clear the draft for this channel
    this.clearDraft();

    // Reset state
    this.messageContent = '';
    this.completedAttachments = [];
    this.pendingUploads = [];
    this.mentionMap.clear();

    // Reset textarea height
    if (this.textareaRef) {
      this.textareaRef.nativeElement.style.height = 'auto';
    }

    // Stop typing indicator
    if (this.isTyping) {
      this.isTyping = false;
      this.typingStopped.emit();
    }
  }

  // Paste and drag-and-drop methods
  onPaste(event: ClipboardEvent): void {
    if (this.disabled) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    this.uploadFiles(files);
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.disabled) return;
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDragOver = true;
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragOver = false;
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragOver = false;
    if (this.disabled) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) {
      this.uploadFiles(files);
    }
  }

  // File upload methods
  triggerFileInput(): void {
    this.fileInputRef?.nativeElement?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    this.uploadFiles(files);

    // Reset the input so the same file can be selected again
    input.value = '';
  }

  uploadFiles(files: File[]): void {
    if (!this.channelId) {
      console.error('Channel ID is required for file upload');
      return;
    }

    files.forEach((file) => {
      // Validate file
      const validation = this.fileUploadService.validateFile(file);
      if (!validation.valid) {
        // Add as error
        this.pendingUploads.push({
          file,
          progress: 0,
          status: 'error',
          error: validation.error,
        });
        return;
      }

      // Add to pending uploads immediately with uploading status
      this.pendingUploads.push({
        file,
        progress: 0,
        status: 'uploading',
      });

      // Start upload
      const upload$ = this.fileUploadService.uploadFile(this.channelId, file);
      const subscription = upload$.subscribe({
        next: (progress) => {
          // Update existing progress entry
          const existingIndex = this.pendingUploads.findIndex(
            (u) => u.file === file
          );
          if (existingIndex >= 0) {
            this.pendingUploads[existingIndex] = progress;
          }

          // If complete, move to completed attachments
          if (progress.status === 'complete' && progress.attachment) {
            this.completedAttachments.push(progress.attachment);
            // Remove from pending
            this.pendingUploads = this.pendingUploads.filter(
              (u) => u.file !== file
            );
            // Save draft with new attachment
            this.triggerDraftSave();
          }
        },
        error: (err) => {
          console.error('Upload error:', err);
          // Mark as error
          const existingIndex = this.pendingUploads.findIndex(
            (u) => u.file === file
          );
          if (existingIndex >= 0) {
            this.pendingUploads[existingIndex] = {
              file,
              progress: 0,
              status: 'error',
              error: 'Upload failed',
            };
          }
        },
      });

      this.uploadSubscriptions.push(subscription);
    });
  }

  removeAttachment(attachment: GridMessageAttachment): void {
    // Remove from UI immediately
    this.completedAttachments = this.completedAttachments.filter(
      (a) => a.id !== attachment.id
    );

    // Delete from S3 and database (fire and forget)
    this.fileUploadService.deleteAttachment(attachment.id).subscribe();

    // Save draft with updated attachments
    this.triggerDraftSave();
  }

  removePendingUpload(upload: GridFileUploadProgress): void {
    this.pendingUploads = this.pendingUploads.filter((u) => u.file !== upload.file);
  }

  getFileIcon(fileType: string): string {
    return this.fileUploadService.getFileIcon(fileType);
  }

  formatFileSize(bytes: number): string {
    return this.fileUploadService.formatFileSize(bytes);
  }

  isImageAttachment(attachment: GridMessageAttachment): boolean {
    return this.fileUploadService.isImageAttachment(attachment);
  }

  // Mention autocomplete methods
  detectMentionTrigger(): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const result = this.mentionService.extractMentionQuery(this.messageContent, cursorPos);

    if (result) {
      this.mentionStartIndex = result.startIndex;
      this.mentionQuery = result.query;
      this.mentionSuggestions = this.mentionService.search(result.query, this.channelId);
      this.showMentionDropdown = this.mentionSuggestions.length > 0;
      this.selectedMentionIndex = 0;
    } else {
      this.closeMentionDropdown();
    }
  }

  selectMention(user: MentionSuggestion): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const result = this.mentionService.insertMention(
      this.messageContent,
      cursorPos,
      this.mentionStartIndex,
      user
    );

    this.messageContent = result.content;
    // Store the mapping for converting on send
    this.mentionMap.set(result.mentionMapping.displayName, result.mentionMapping.userId);
    this.closeMentionDropdown();

    // Set cursor position after the mention
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(result.cursorPos, result.cursorPos);
    });

    // Trigger draft save
    this.triggerDraftSave();
  }

  closeMentionDropdown(): void {
    this.showMentionDropdown = false;
    this.mentionSuggestions = [];
    this.selectedMentionIndex = 0;
    this.mentionQuery = '';
  }

  getUserInitials(user: MentionSuggestion): string {
    return user.display_name
      .split(' ')
      .map((n) => n.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  /**
   * Get list of users currently mentioned in the message content.
   * Parses @[DisplayName] format used in the textarea.
   */
  get currentMentions(): { displayName: string; userId: string }[] {
    if (!this.messageContent) return [];

    // Extract display names from @[DisplayName] format
    const displayNames = this.mentionService.extractDisplayMentions(this.messageContent);

    return displayNames.map(displayName => ({
      displayName,
      userId: this.mentionMap.get(displayName) || ''
    }));
  }

  /**
   * Remove a mention from the message content by display name.
   */
  removeMention(displayName: string): void {
    // Remove the mention pattern from content (escape special regex chars in display name)
    const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`@\\[${escapedName}\\]\\s*`, 'g');
    this.messageContent = this.messageContent.replace(pattern, '').trim();

    // Remove from mapping
    this.mentionMap.delete(displayName);

    this.triggerDraftSave();
  }

  private adjustTextareaHeight(): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) return;

    // Reset height to auto to get correct scrollHeight
    textarea.style.height = 'auto';

    // Set new height (max 200px)
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${newHeight}px`;
  }

  focusInput(): void {
    this.textareaRef?.nativeElement?.focus();
  }

  // Emoji picker methods
  toggleEmojiPicker(): void {
    this.showEmojiPicker = !this.showEmojiPicker;
    // Close mention dropdown when opening emoji picker
    if (this.showEmojiPicker) {
      this.closeMentionDropdown();
    }
  }

  closeEmojiPicker(): void {
    this.showEmojiPicker = false;
  }

  selectEmojiCategory(index: number): void {
    this.selectedEmojiCategoryIndex = index;
  }

  selectEmoji(emoji: string): void {
    const textarea = this.textareaRef?.nativeElement;
    if (!textarea) {
      // Fallback: append to end of message
      this.messageContent += emoji;
      this.closeEmojiPicker();
      return;
    }

    // Get current cursor position
    const cursorPos = textarea.selectionStart;
    const textBefore = this.messageContent.substring(0, cursorPos);
    const textAfter = this.messageContent.substring(cursorPos);

    // Insert emoji at cursor position
    this.messageContent = textBefore + emoji + textAfter;

    // Close picker
    this.closeEmojiPicker();

    // Set cursor position after the emoji
    const newCursorPos = cursorPos + emoji.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });

    // Trigger draft save
    this.triggerDraftSave();
  }

  onEmojiPickerBackdropClick(): void {
    this.closeEmojiPicker();
  }

  // GIF picker methods
  get isGifEnabled(): boolean {
    return this.gifService.isConfigured();
  }

  get displayedGifs(): GiphyGif[] {
    return this.gifSearchQuery.trim() ? this.gifResults : this.trendingGifs;
  }

  toggleGifPicker(): void {
    this.showGifPicker = !this.showGifPicker;
    if (this.showGifPicker) {
      // Close other pickers
      this.closeEmojiPicker();
      this.closeMentionDropdown();
      // Load trending GIFs on first open (only if API is configured)
      if (this.isGifEnabled && this.trendingGifs.length === 0) {
        this.loadTrendingGifs();
      }
    } else {
      this.resetGifPicker();
    }
  }

  closeGifPicker(): void {
    this.showGifPicker = false;
    this.resetGifPicker();
  }

  private resetGifPicker(): void {
    this.gifSearchQuery = '';
    this.gifResults = [];
    this.isLoadingGifs = false;
    this.gifSearchError = false;
  }

  loadTrendingGifs(): void {
    this.isLoadingGifs = true;
    this.gifSearchError = false;
    this.gifService.getTrendingGifs(25).subscribe({
      next: (gifs) => {
        this.trendingGifs = gifs;
        this.isLoadingGifs = false;
      },
      error: () => {
        this.isLoadingGifs = false;
        this.gifSearchError = true;
      },
    });
  }

  onGifSearchInput(): void {
    const query = this.gifSearchQuery.trim();
    if (query.length === 0) {
      this.gifResults = [];
      return;
    }
    this.gifSearchSubject.next(query);
  }

  private performGifSearch(query: string): void {
    if (!query) return;
    this.isLoadingGifs = true;
    this.gifSearchError = false;
    this.gifService.searchGifs(query, 25).subscribe({
      next: (gifs) => {
        this.gifResults = gifs;
        this.isLoadingGifs = false;
      },
      error: () => {
        this.isLoadingGifs = false;
        this.gifSearchError = true;
      },
    });
  }

  selectGif(gif: GiphyGif): void {
    const textarea = this.textareaRef?.nativeElement;
    const gifUrl = gif.url;

    if (!textarea) {
      // Fallback: append to end of message
      this.messageContent = this.messageContent.trim()
        ? `${this.messageContent} ${gifUrl}`
        : gifUrl;
    } else {
      // Get current cursor position
      const cursorPos = textarea.selectionStart;
      const textBefore = this.messageContent.substring(0, cursorPos);
      const textAfter = this.messageContent.substring(cursorPos);

      // Add space before GIF URL if needed
      const needsSpaceBefore = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
      const needsSpaceAfter = textAfter.length > 0 && !textAfter.startsWith(' ') && !textAfter.startsWith('\n');

      const spaceBefore = needsSpaceBefore ? ' ' : '';
      const spaceAfter = needsSpaceAfter ? ' ' : '';

      this.messageContent = textBefore + spaceBefore + gifUrl + spaceAfter + textAfter;

      // Set cursor position after the GIF URL
      const newCursorPos = cursorPos + spaceBefore.length + gifUrl.length + spaceAfter.length;
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      });
    }

    this.closeGifPicker();
    this.triggerDraftSave();
  }

  onGifPickerBackdropClick(): void {
    this.closeGifPicker();
  }

  // Draft persistence methods
  private triggerDraftSave(): void {
    if (!this.isRestoringDraft) {
      this.draftSaveSubject.next();
    }
  }

  private saveDraft(): void {
    if (!this.channelId || this.isRestoringDraft) return;
    this.draftService.saveDraft(
      this.channelId,
      this.messageContent,
      this.completedAttachments
    );
  }

  private saveDraftForChannel(
    channelId: string,
    content: string,
    attachments: GridMessageAttachment[]
  ): void {
    if (!channelId) return;
    this.draftService.saveDraft(channelId, content, attachments);
  }

  private restoreDraft(channelId: string): void {
    // Clear current state first
    this.messageContent = '';
    this.completedAttachments = [];
    this.pendingUploads = [];

    // Reset textarea height
    if (this.textareaRef) {
      this.textareaRef.nativeElement.style.height = 'auto';
    }

    // Check for saved draft
    this.isRestoringDraft = true;

    // Use validation to check if attachments still exist
    this.draftService.getDraftWithValidation(channelId).subscribe({
      next: (draft) => {
        if (draft) {
          this.messageContent = draft.messageContent;
          this.completedAttachments = draft.attachments;

          // Adjust textarea height for restored content
          setTimeout(() => {
            this.adjustTextareaHeight();
          });
        }
        this.isRestoringDraft = false;
      },
      error: () => {
        this.isRestoringDraft = false;
      },
    });
  }

  private clearDraft(): void {
    if (this.channelId) {
      this.draftService.clearDraft(this.channelId);
    }
  }
}
