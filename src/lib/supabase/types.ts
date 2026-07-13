export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          action: string
          active: boolean
          created_at: string
          id: string
          name: string
          notify_email: boolean
          notify_slack: boolean
          threshold: number
          trigger: string
        }
        Insert: {
          action?: string
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notify_email?: boolean
          notify_slack?: boolean
          threshold?: number
          trigger?: string
        }
        Update: {
          action?: string
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notify_email?: boolean
          notify_slack?: boolean
          threshold?: number
          trigger?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          ad_set: string | null
          budget_daily: number | null
          id: string
          meta_campaign_id: string | null
          name: string
          objective: string | null
          purchases_7d: number | null
          reach_7d: number | null
          roas: number | null
          spend_7d: number | null
          status: string | null
          updated_at: string
        }
        Insert: {
          ad_set?: string | null
          budget_daily?: number | null
          id?: string
          meta_campaign_id?: string | null
          name: string
          objective?: string | null
          purchases_7d?: number | null
          reach_7d?: number | null
          roas?: number | null
          spend_7d?: number | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          ad_set?: string | null
          budget_daily?: number | null
          id?: string
          meta_campaign_id?: string | null
          name?: string
          objective?: string | null
          purchases_7d?: number | null
          reach_7d?: number | null
          roas?: number | null
          spend_7d?: number | null
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          invited_by: string | null
          role: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          invited_by?: string | null
          role?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          invited_by?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          product_id: string | null
          read: boolean
          severity: string
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          read?: boolean
          severity?: string
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          product_id?: string | null
          read?: boolean
          severity?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_campaign_links: {
        Row: {
          auto_action: string
          campaign_id: string
          created_at: string
          id: string
          product_id: string
        }
        Insert: {
          auto_action?: string
          campaign_id: string
          created_at?: string
          id?: string
          product_id: string
        }
        Update: {
          auto_action?: string
          campaign_id?: string
          created_at?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_campaign_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_campaign_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          alert_threshold: number
          barcode: string | null
          category: string | null
          cost: number | null
          created_at: string
          id: string
          image_url: string | null
          images: string[] | null
          name: string
          price: number | null
          provider: string | null
          shopify_id: string | null
          shopify_status: string | null
          sku: string | null
          stock: number
          updated_at: string
        }
        Insert: {
          alert_threshold?: number
          barcode?: string | null
          category?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          images?: string[] | null
          name: string
          price?: number | null
          provider?: string | null
          shopify_id?: string | null
          shopify_status?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string
        }
        Update: {
          alert_threshold?: number
          barcode?: string | null
          category?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          images?: string[] | null
          name?: string
          price?: number | null
          provider?: string | null
          shopify_id?: string | null
          shopify_status?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          article: string
          brand: string | null
          color: string | null
          created_at: string
          customer_address: string | null
          customer_contact: string | null
          customer_dni: string | null
          customer_name: string | null
          delivered: boolean
          discount: number
          id: string
          installments: number | null
          invoice_path: string | null
          invoiced: boolean
          is_other_brand: boolean
          notes: string | null
          payment_method: string | null
          pos: string | null
          price: number
          product_id: string | null
          qty: number
          seller_id: string | null
          seller_name: string | null
          sold_at: string
          stock_deducted: boolean
          talle: string | null
          variant_gid: string | null
        }
        Insert: {
          article: string
          brand?: string | null
          color?: string | null
          created_at?: string
          customer_address?: string | null
          customer_contact?: string | null
          customer_dni?: string | null
          customer_name?: string | null
          delivered?: boolean
          discount?: number
          id?: string
          installments?: number | null
          invoice_path?: string | null
          invoiced?: boolean
          is_other_brand?: boolean
          notes?: string | null
          payment_method?: string | null
          pos?: string | null
          price: number
          product_id?: string | null
          qty?: number
          seller_id?: string | null
          seller_name?: string | null
          sold_at?: string
          stock_deducted?: boolean
          talle?: string | null
          variant_gid?: string | null
        }
        Update: {
          article?: string
          brand?: string | null
          color?: string | null
          created_at?: string
          customer_address?: string | null
          customer_contact?: string | null
          customer_dni?: string | null
          customer_name?: string | null
          delivered?: boolean
          discount?: number
          id?: string
          installments?: number | null
          invoice_path?: string | null
          invoiced?: boolean
          is_other_brand?: boolean
          notes?: string | null
          payment_method?: string | null
          pos?: string | null
          price?: number
          product_id?: string | null
          qty?: number
          seller_id?: string | null
          seller_name?: string | null
          sold_at?: string
          stock_deducted?: boolean
          talle?: string | null
          variant_gid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
