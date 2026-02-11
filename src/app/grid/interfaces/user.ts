export interface User {
  id?: string;
  sFirstName: string;
  sLastName: string;
  sFullName?: string;
  sRole: string; // Keep for backwards compatibility
  sRoles?: string[]; // New multiple roles field
  sEmail: string;
  sPhone: string;
  sUID: string;
  sTwilioPhone?: string;
  dtCreated: Date;
  sCreatedBy: string;
  dtLastActivity?: Date;
  profileImage?: string | null;
  avatarColor?: string;
  darkMode?: boolean;
  /**
   * @deprecated Use sales_consultants collection instead. This field is only used to determine
   * if a user should be looked up in sales_consultants. The actual email is stored in
   * sales_consultants.userEmail field.
   */
  legacySalesEmails?: string[]; // Legacy emails for backwards compatibility (Sales role only)
  managerId?: string | null; // User ID of this user's manager
  timeApprovers?: string[]; // User IDs of people who approve this user's time
}
