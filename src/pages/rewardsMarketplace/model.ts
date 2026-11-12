import { formatInteger, type IntegerValue } from "../../lib/partnerMarketplace";

export type Scope = "dadofit" | "partner";
export type RedemptionResult = {
  title: string;
  new_balance: IntegerValue;
  payment_currency: "dc" | "gp" | "sp";
  payment_amount: IntegerValue;
  redemption_reference: string | null;
  assigned_code: string | null;
  redemption_url: string | null;
};
export type FulfillmentDto = {
  assigned_code?: string | null;
  redemption_url?: string | null;
  fulfillment_instructions?: string | null;
  validation_token?: string | null;
  fulfillment_notes?: string | null;
};
export const typeLabels: Record<string, string> = {
  discount: "Descuento",
  product: "Producto",
  gym_pass: "Pase de Gym",
  subscription: "Suscripción",
  experience: "Experiencia",
  other: "Otro",
};
export const fulfillmentLabels: Record<string, string> = {
  digital_code: "Código digital",
  digital_benefit: "Beneficio digital",
  physical_product: "Producto físico",
  in_person: "Canje presencial",
};
export const fmt = formatInteger;
export const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
