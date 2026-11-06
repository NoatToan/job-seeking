import type { FeedbackKind, FeedbackStatus } from "./types";

/** Every user-visible string. Hosts pass `strings.en`/`strings.vi` or their own translation. */
export interface ContributorStrings {
  fabLabel: string;
  panelTitle: string;
  close: string;
  kindLabel: string;
  kind: Record<FeedbackKind, string>;
  status: Record<FeedbackStatus, string>;
  titleLabel: string;
  titlePlaceholder: Record<FeedbackKind, string>;
  bodyLabel: string;
  bodyPlaceholder: string;
  pointButton: string;
  repointButton: string;
  clearPoint: string;
  pickerHint: string;
  pickerCancel: string;
  pickedElement: (label: string) => string;
  pickedRegion: (w: number, h: number) => string;
  screenshotLabel: string;
  screenshotHint: string;
  screenshotCapturing: string;
  screenshotFailed: string;
  screenshotAlt: string;
  pageLabel: string;
  submit: string;
  submitting: string;
  sent: string;
  sentDetail: string;
  /** "Sent" view for a signed-out visitor, who cannot follow the item. */
  sentDetailAnonymous: string;
  sendAnother: string;
  seeAll: string;
  signInPrompt: string;
  /** Above the form for a signed-out visitor when anonymous feedback is on. */
  guestHint: string;
  /** Link after `guestHint`. */
  guestSignIn: string;
  nameLabel: string;
  namePlaceholder: string;
  /** Shown for an anonymous item without a name (admin review). */
  anonymous: string;
  signIn: string;
  errorGeneric: string;
  errorRateLimited: string;
  titleTooShort: string;
  // Board
  boardTitle: string;
  boardSubtitle: string;
  tabBoard: string;
  tabMine: string;
  sortNew: string;
  sortTop: string;
  allKinds: string;
  newIdea: string;
  emptyBoard: string;
  emptyMine: string;
  loadMore: string;
  loading: string;
  retry: string;
  vote: string;
  unvote: string;
  votes: (n: number) => string;
  teamReply: string;
  history: string;
  statusChange: (from: string, to: string) => string;
  deleteItem: string;
  deleteConfirm: string;
  back: string;
  // Admin
  adminTitle: string;
  adminSubtitle: string;
  allStatuses: string;
  search: string;
  author: string;
  createdAt: string;
  context: string;
  selector: string;
  elementText: string;
  region: string;
  viewport: string;
  userAgent: string;
  noContext: string;
  edit: string;
  save: string;
  saving: string;
  saved: string;
  cancel: string;
  statusLabel: string;
  responseLabel: string;
  responseHint: string;
  notes: string;
  addNote: string;
  noteLabel: string;
  visibilityLabel: string;
  visibilityInternal: string;
  visibilityPublic: string;
  noNotes: string;
  deleteNote: string;
  selectItem: string;
  emptyQueue: string;
  forbidden: string;
}

const en: ContributorStrings = {
  fabLabel: "Send feedback",
  panelTitle: "Send feedback",
  close: "Close",
  kindLabel: "Type",
  kind: { bug: "Bug", feedback: "Feedback", idea: "Feature idea" },
  status: {
    new: "New",
    under_review: "Under review",
    approved: "Approved",
    planned: "Planned",
    done: "Done",
    rejected: "Not planned",
  },
  titleLabel: "Title",
  titlePlaceholder: {
    bug: "What went wrong?",
    feedback: "What would you like to tell us?",
    idea: "What should we build?",
  },
  bodyLabel: "Details (optional)",
  bodyPlaceholder: "What did you expect? What happened instead?",
  pointButton: "Point at the page",
  repointButton: "Point again",
  clearPoint: "Remove",
  pickerHint: "Click an element or drag over an area. Keyboard: Tab to move, Enter to select, Esc to cancel.",
  pickerCancel: "Cancel",
  pickedElement: (label) => `Selected: ${label}`,
  pickedRegion: (w, h) => `Selected area: ${w} × ${h}`,
  screenshotLabel: "Attach a screenshot of this page",
  screenshotHint: "Only the visible part. Password fields are left out.",
  screenshotCapturing: "Taking screenshot…",
  screenshotFailed: "We couldn't take a screenshot. You can still send your feedback.",
  screenshotAlt: "Screenshot of the page with the selected area highlighted",
  pageLabel: "Page",
  submit: "Send feedback",
  submitting: "Sending…",
  sent: "Thank you!",
  sentDetail: "We got it. You can follow its status on the contributor page.",
  sentDetailAnonymous: "We got it, thank you. The team reads every message.",
  sendAnother: "Send another",
  seeAll: "See all ideas",
  signInPrompt: "Sign in to send feedback and vote on ideas.",
  guestHint: "You're sending this as a guest.",
  guestSignIn: "Sign in to follow its status",
  nameLabel: "Your name (optional)",
  namePlaceholder: "Anonymous",
  anonymous: "Anonymous",
  signIn: "Sign in",
  errorGeneric: "We couldn't send this. It's on our side, not yours. Please try again.",
  errorRateLimited: "You've sent a lot this hour. Please try again later.",
  titleTooShort: "Please write at least 3 characters.",
  boardTitle: "Contribute",
  boardSubtitle: "Vote on ideas, suggest features and follow what you sent us.",
  tabBoard: "Ideas board",
  tabMine: "My feedback",
  sortNew: "Newest",
  sortTop: "Most votes",
  allKinds: "All types",
  newIdea: "Suggest an idea",
  emptyBoard: "No approved ideas yet. Be the first to suggest one.",
  emptyMine: "You haven't sent anything yet. Use the feedback button on any page.",
  loadMore: "Load more",
  loading: "Loading…",
  retry: "Try again",
  vote: "Vote",
  unvote: "Remove vote",
  votes: (n) => (n === 1 ? "1 vote" : `${n} votes`),
  teamReply: "Reply from the team",
  history: "History",
  statusChange: (from, to) => `${from} → ${to}`,
  deleteItem: "Delete",
  deleteConfirm: "Delete this item? This can't be undone.",
  back: "Back",
  adminTitle: "Review feedback",
  adminSubtitle: "Approve, plan and answer what people send.",
  allStatuses: "All statuses",
  search: "Search",
  author: "From",
  createdAt: "Sent",
  context: "Context",
  selector: "Element",
  elementText: "Element text",
  region: "Area",
  viewport: "Viewport",
  userAgent: "Browser",
  noContext: "No page context was captured.",
  edit: "Edit",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  cancel: "Cancel",
  statusLabel: "Status",
  responseLabel: "Public reply",
  responseHint: "Shown to everyone who can see this item.",
  notes: "Notes",
  addNote: "Add note",
  noteLabel: "Note",
  visibilityLabel: "Who can see this note",
  visibilityInternal: "Internal (admins only)",
  visibilityPublic: "Public",
  noNotes: "No notes yet.",
  deleteNote: "Delete note",
  selectItem: "Select an item to review it.",
  emptyQueue: "Nothing here. Try another filter.",
  forbidden: "This page is for admins.",
};

const vi: ContributorStrings = {
  ...en,
  fabLabel: "Gửi góp ý",
  panelTitle: "Gửi góp ý",
  close: "Đóng",
  kindLabel: "Loại",
  kind: { bug: "Lỗi", feedback: "Góp ý", idea: "Ý tưởng tính năng" },
  status: {
    new: "Mới",
    under_review: "Đang xem xét",
    approved: "Đã duyệt",
    planned: "Đã lên kế hoạch",
    done: "Đã xong",
    rejected: "Không thực hiện",
  },
  titleLabel: "Tiêu đề",
  titlePlaceholder: {
    bug: "Có gì không đúng?",
    feedback: "Bạn muốn nói gì với chúng tôi?",
    idea: "Chúng tôi nên làm gì?",
  },
  bodyLabel: "Chi tiết (không bắt buộc)",
  bodyPlaceholder: "Bạn mong đợi điều gì? Điều gì đã xảy ra?",
  pointButton: "Chỉ vào trang",
  repointButton: "Chỉ lại",
  clearPoint: "Bỏ chọn",
  pickerHint: "Bấm vào một phần tử hoặc kéo để chọn vùng. Bàn phím: Tab để di chuyển, Enter để chọn, Esc để hủy.",
  pickerCancel: "Hủy",
  pickedElement: (label) => `Đã chọn: ${label}`,
  pickedRegion: (w, h) => `Vùng đã chọn: ${w} × ${h}`,
  screenshotLabel: "Đính kèm ảnh chụp trang này",
  screenshotHint: "Chỉ phần đang hiển thị. Ô mật khẩu được bỏ qua.",
  screenshotCapturing: "Đang chụp màn hình…",
  screenshotFailed: "Không chụp được màn hình. Bạn vẫn có thể gửi góp ý.",
  screenshotAlt: "Ảnh chụp trang với vùng đã chọn được tô sáng",
  pageLabel: "Trang",
  submit: "Gửi góp ý",
  submitting: "Đang gửi…",
  sent: "Cảm ơn bạn!",
  sentDetail: "Chúng tôi đã nhận. Bạn có thể theo dõi trạng thái ở trang Đóng góp.",
  sentDetailAnonymous: "Chúng tôi đã nhận, cảm ơn bạn. Nhóm đọc mọi góp ý.",
  sendAnother: "Gửi thêm",
  seeAll: "Xem tất cả ý tưởng",
  signInPrompt: "Đăng nhập để gửi góp ý và bình chọn ý tưởng.",
  guestHint: "Bạn đang gửi với tư cách khách.",
  guestSignIn: "Đăng nhập để theo dõi trạng thái",
  nameLabel: "Tên của bạn (không bắt buộc)",
  namePlaceholder: "Ẩn danh",
  anonymous: "Ẩn danh",
  signIn: "Đăng nhập",
  errorGeneric: "Chưa gửi được. Lỗi ở phía chúng tôi. Vui lòng thử lại.",
  errorRateLimited: "Bạn đã gửi khá nhiều trong giờ này. Vui lòng thử lại sau.",
  titleTooShort: "Vui lòng viết ít nhất 3 ký tự.",
  boardTitle: "Đóng góp",
  boardSubtitle: "Bình chọn ý tưởng, đề xuất tính năng và theo dõi những gì bạn đã gửi.",
  tabBoard: "Bảng ý tưởng",
  tabMine: "Góp ý của tôi",
  sortNew: "Mới nhất",
  sortTop: "Nhiều bình chọn",
  allKinds: "Mọi loại",
  newIdea: "Đề xuất ý tưởng",
  emptyBoard: "Chưa có ý tưởng nào được duyệt. Hãy là người đầu tiên đề xuất.",
  emptyMine: "Bạn chưa gửi gì. Dùng nút góp ý ở bất kỳ trang nào.",
  loadMore: "Xem thêm",
  loading: "Đang tải…",
  retry: "Thử lại",
  vote: "Bình chọn",
  unvote: "Bỏ bình chọn",
  votes: (n) => `${n} bình chọn`,
  teamReply: "Phản hồi từ đội ngũ",
  history: "Lịch sử",
  deleteItem: "Xóa",
  deleteConfirm: "Xóa mục này? Không thể hoàn tác.",
  back: "Quay lại",
  adminTitle: "Duyệt góp ý",
  adminSubtitle: "Duyệt, lên kế hoạch và trả lời những gì người dùng gửi.",
  allStatuses: "Mọi trạng thái",
  search: "Tìm kiếm",
  author: "Người gửi",
  createdAt: "Gửi lúc",
  context: "Ngữ cảnh",
  selector: "Phần tử",
  elementText: "Nội dung phần tử",
  region: "Vùng",
  viewport: "Khung nhìn",
  userAgent: "Trình duyệt",
  noContext: "Không có ngữ cảnh trang.",
  edit: "Sửa",
  save: "Lưu",
  saving: "Đang lưu…",
  saved: "Đã lưu",
  cancel: "Hủy",
  statusLabel: "Trạng thái",
  responseLabel: "Phản hồi công khai",
  responseHint: "Hiển thị cho mọi người xem được mục này.",
  notes: "Ghi chú",
  addNote: "Thêm ghi chú",
  noteLabel: "Ghi chú",
  visibilityLabel: "Ai xem được ghi chú này",
  visibilityInternal: "Nội bộ (chỉ admin)",
  visibilityPublic: "Công khai",
  noNotes: "Chưa có ghi chú.",
  deleteNote: "Xóa ghi chú",
  selectItem: "Chọn một mục để duyệt.",
  emptyQueue: "Không có mục nào. Thử bộ lọc khác.",
  forbidden: "Trang này dành cho admin.",
};

export const strings = { en, vi } as const;
