/**
 * HAND-WRITTEN INTERIM TYPES -- REGENERATE WHEN A LOCAL STACK EXISTS.
 *
 * This file intentionally contains the wedding schema rather than every
 * tenant in the shared Supabase project. Its shapes track the checked-in
 * rachandzach migrations and are verified against generated linked-project
 * types whenever the remote schema changes.
 *
 * Once Docker (or another container runtime) is available, regenerate with
 * `npm run types:generate`, which must be wired (by the package.json owner;
 * this packet does not edit package.json) to:
 *
 *   supabase gen types typescript --local > src/lib/supabase/database.types.ts
 *
 * and diff the result against this file. Any drift is a bug in one of the two.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      rachandzach_events: {
        Row: {
          id: string;
          slug: string;
          name: string;
          sort_order: number;
          starts_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          sort_order?: number;
          starts_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          sort_order?: number;
          starts_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rachandzach_people: {
        Row: {
          id: string;
          slug: string;
          display_name: string;
          aliases: string[];
          photo_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          display_name: string;
          aliases?: string[];
          photo_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          display_name?: string;
          aliases?: string[];
          photo_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rachandzach_person_overrides: {
        Row: {
          person_slug: string;
          display_name: string | null;
          hidden: boolean;
          added: boolean;
          face_photo_id: string | null;
          face_crop_x: number | null;
          face_crop_y: number | null;
          face_crop_size: number | null;
          created_at: string;
          updated_at: string;
          updated_by: string;
        };
        Insert: {
          person_slug: string;
          display_name?: string | null;
          hidden?: boolean;
          added?: boolean;
          face_photo_id?: string | null;
          face_crop_x?: number | null;
          face_crop_y?: number | null;
          face_crop_size?: number | null;
          created_at?: string;
          updated_at?: string;
          updated_by: string;
        };
        Update: {
          person_slug?: string;
          display_name?: string | null;
          hidden?: boolean;
          added?: boolean;
          face_photo_id?: string | null;
          face_crop_x?: number | null;
          face_crop_y?: number | null;
          face_crop_size?: number | null;
          created_at?: string;
          updated_at?: string;
          updated_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_person_overrides_face_photo_id_fkey";
            columns: ["face_photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_photos: {
        Row: {
          id: string;
          image_data_hash: string;
          file_sha256: string;
          event_id: string | null;
          original_bucket: string;
          original_object: string;
          original_filename: string;
          original_bytes: number;
          width: number | null;
          height: number | null;
          captured_at: string | null;
          source: string;
          status: string;
          submitted_batch_id: string | null;
          processing_complete: boolean;
          uploader_caption: string | null;
          uploader_caption_byline: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          image_data_hash: string;
          file_sha256: string;
          event_id?: string | null;
          original_bucket?: string;
          original_object: string;
          original_filename: string;
          original_bytes: number;
          width?: number | null;
          height?: number | null;
          captured_at?: string | null;
          source: string;
          status?: string;
          submitted_batch_id?: string | null;
          processing_complete?: boolean;
          uploader_caption?: string | null;
          uploader_caption_byline?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          image_data_hash?: string;
          file_sha256?: string;
          event_id?: string | null;
          original_bucket?: string;
          original_object?: string;
          original_filename?: string;
          original_bytes?: number;
          width?: number | null;
          height?: number | null;
          captured_at?: string | null;
          source?: string;
          status?: string;
          submitted_batch_id?: string | null;
          processing_complete?: boolean;
          uploader_caption?: string | null;
          uploader_caption_byline?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_photos_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rachandzach_photos_submitted_batch_id_fkey";
            columns: ["submitted_batch_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_upload_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_photo_people: {
        Row: {
          photo_id: string;
          person_id: string;
          source: string;
          confidence: string;
          created_at: string;
        };
        Insert: {
          photo_id: string;
          person_id: string;
          source?: string;
          confidence?: string;
          created_at?: string;
        };
        Update: {
          photo_id?: string;
          person_id?: string;
          source?: string;
          confidence?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_photo_people_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rachandzach_photo_people_person_id_fkey";
            columns: ["person_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_people";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_photo_keywords: {
        Row: {
          photo_id: string;
          keyword: string;
          created_at: string;
        };
        Insert: {
          photo_id: string;
          keyword: string;
          created_at?: string;
        };
        Update: {
          photo_id?: string;
          keyword?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_photo_keywords_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_photo_previews: {
        Row: {
          photo_id: string;
          width: number;
          format: string;
          bucket: string;
          object_path: string;
          bytes: number;
          created_at: string;
        };
        Insert: {
          photo_id: string;
          width: number;
          format: string;
          bucket?: string;
          object_path: string;
          bytes: number;
          created_at?: string;
        };
        Update: {
          photo_id?: string;
          width?: number;
          format?: string;
          bucket?: string;
          object_path?: string;
          bytes?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_photo_previews_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_upload_batches: {
        Row: {
          id: string;
          receipt_hash: string;
          email: string | null;
          display_name: string | null;
          note: string | null;
          status: string;
          submitted_at: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          receipt_hash: string;
          email?: string | null;
          display_name?: string | null;
          note?: string | null;
          status?: string;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          receipt_hash?: string;
          email?: string | null;
          display_name?: string | null;
          note?: string | null;
          status?: string;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rachandzach_upload_items: {
        Row: {
          id: string;
          batch_id: string;
          original_name: string;
          object_path: string;
          bytes: number;
          media_type: string;
          sha256: string | null;
          status: string;
          rejection_reason: string | null;
          note_approved: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          original_name: string;
          object_path: string;
          bytes: number;
          media_type: string;
          sha256?: string | null;
          status?: string;
          rejection_reason?: string | null;
          note_approved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          original_name?: string;
          object_path?: string;
          bytes?: number;
          media_type?: string;
          sha256?: string | null;
          status?: string;
          rejection_reason?: string | null;
          note_approved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_upload_items_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_upload_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_moderation_actions: {
        Row: {
          id: string;
          batch_id: string | null;
          item_id: string | null;
          actor_user_id: string;
          action: string;
          before: Json;
          after: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id?: string | null;
          item_id?: string | null;
          actor_user_id: string;
          action: string;
          before?: Json;
          after?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string | null;
          item_id?: string | null;
          actor_user_id?: string;
          action?: string;
          before?: Json;
          after?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_moderation_actions_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_upload_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rachandzach_moderation_actions_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_upload_items";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_notification_log: {
        Row: {
          id: string;
          batch_id: string;
          kind: string;
          idempotency_key: string;
          provider_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          batch_id: string;
          kind: string;
          idempotency_key: string;
          provider_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          batch_id?: string;
          kind?: string;
          idempotency_key?: string;
          provider_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_notification_log_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_upload_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_rate_limit_buckets: {
        Row: {
          key_hash: string;
          action: string;
          window_start: string;
          attempts: number;
        };
        Insert: {
          key_hash: string;
          action: string;
          window_start: string;
          attempts?: number;
        };
        Update: {
          key_hash?: string;
          action?: string;
          window_start?: string;
          attempts?: number;
        };
        Relationships: [];
      };
      rachandzach_gallery_events: {
        Row: {
          id: string;
          event_name: string;
          anonymous_session_hash: string | null;
          photo_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_name: string;
          anonymous_session_hash?: string | null;
          photo_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_name?: string;
          anonymous_session_hash?: string | null;
          photo_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_gallery_events_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
        ];
      };
      rachandzach_guest_favorites: {
        Row: {
          owner_kind: string;
          owner_key: string;
          photo_id: string;
          created_at: string;
        };
        Insert: {
          owner_kind: string;
          owner_key: string;
          photo_id: string;
          created_at?: string;
        };
        Update: {
          owner_kind?: string;
          owner_key?: string;
          photo_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rachandzach_guest_favorites_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "rachandzach_photos";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      rachandzach_add_person: {
        Args: {
          p_slug: string;
          p_display_name: string;
          p_actor: string;
        };
        Returns: string;
      };
      rachandzach_consume_rate_limit: {
        Args: {
          key_hash: string;
          action: string;
          attempt_limit: number;
          window_seconds: number;
        };
        Returns: boolean;
      };
      rachandzach_gallery_event_metadata_is_allowed: {
        Args: {
          metadata: Json;
        };
        Returns: boolean;
      };
      rachandzach_remove_added_person: {
        Args: {
          p_slug: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Convenience helpers matching the shapes emitted by `supabase gen types`.

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

export type Functions<T extends keyof PublicSchema["Functions"]> =
  PublicSchema["Functions"][T];
