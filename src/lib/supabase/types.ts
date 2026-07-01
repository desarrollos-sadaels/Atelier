export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      automation_rules: {
        Row: {
          action: string;
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          notify_email: boolean;
          notify_slack: boolean;
          threshold: number;
          trigger: string;
        };
        Insert: {
          action?: string;
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          notify_email?: boolean;
          notify_slack?: boolean;
          threshold?: number;
          trigger?: string;
        };
        Update: {
          action?: string;
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          notify_email?: boolean;
          notify_slack?: boolean;
          threshold?: number;
          trigger?: string;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          ad_set: string | null;
          budget_daily: number | null;
          id: string;
          meta_campaign_id: string | null;
          name: string;
          objective: string | null;
          purchases_7d: number | null;
          reach_7d: number | null;
          roas: number | null;
          spend_7d: number | null;
          status: string | null;
          updated_at: string;
        };
        Insert: {
          ad_set?: string | null;
          budget_daily?: number | null;
          id?: string;
          meta_campaign_id?: string | null;
          name: string;
          objective?: string | null;
          purchases_7d?: number | null;
          reach_7d?: number | null;
          roas?: number | null;
          spend_7d?: number | null;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          ad_set?: string | null;
          budget_daily?: number | null;
          id?: string;
          meta_campaign_id?: string | null;
          name?: string;
          objective?: string | null;
          purchases_7d?: number | null;
          reach_7d?: number | null;
          roas?: number | null;
          spend_7d?: number | null;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          product_id: string | null;
          read: boolean;
          severity: string;
          title: string;
          type: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string | null;
          read?: boolean;
          severity?: string;
          title: string;
          type: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string | null;
          read?: boolean;
          severity?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_campaign_links: {
        Row: {
          auto_action: string;
          campaign_id: string;
          created_at: string;
          id: string;
          product_id: string;
        };
        Insert: {
          auto_action?: string;
          campaign_id: string;
          created_at?: string;
          id?: string;
          product_id: string;
        };
        Update: {
          auto_action?: string;
          campaign_id?: string;
          created_at?: string;
          id?: string;
          product_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_campaign_links_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_campaign_links_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          alert_threshold: number;
          barcode: string | null;
          category: string | null;
          cost: number | null;
          created_at: string;
          id: string;
          image_url: string | null;
          images: string[] | null;
          name: string;
          price: number | null;
          provider: string | null;
          shopify_id: string | null;
          shopify_status: string | null;
          sku: string | null;
          stock: number;
          updated_at: string;
        };
        Insert: {
          alert_threshold?: number;
          barcode?: string | null;
          category?: string | null;
          cost?: number | null;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          images?: string[] | null;
          name: string;
          price?: number | null;
          provider?: string | null;
          shopify_id?: string | null;
          shopify_status?: string | null;
          sku?: string | null;
          stock?: number;
          updated_at?: string;
        };
        Update: {
          alert_threshold?: number;
          barcode?: string | null;
          category?: string | null;
          cost?: number | null;
          created_at?: string;
          id?: string;
          image_url?: string | null;
          images?: string[] | null;
          name?: string;
          price?: number | null;
          provider?: string | null;
          shopify_id?: string | null;
          shopify_status?: string | null;
          sku?: string | null;
          stock?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          role: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id: string;
          role?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          role?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
