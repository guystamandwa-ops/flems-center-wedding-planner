import { send } from "jsr:@daaku/webpush@0.2.0";

type Reminder = {
  subscription_id: string; guest_id: string; endpoint: string; p256dh: string; auth: string;
  guest_name: string; couple_name: string; invitation_token: string; wedding_date: string;
  reminder_days: 7 | 2 | 1;
};
function kinshasaDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let secretKey = "";
  try {
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    secretKey = secretKeys.default ?? "";
  } catch {
    secretKey = "";
  }
  if (!supabaseUrl || !secretKey) return json({ error: "La clé serveur Supabase n’est pas disponible." }, 503);

  // Secret API keys must be sent in the apikey header only (not Authorization: Bearer).
  async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "apikey": secretKey, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${name}: ${response.status} ${text}`);
    return text ? JSON.parse(text) as T : null as T;
  }

  let secrets: { cron_secret?: string; vapid_private_jwk?: string };
  try {
    secrets = await rpc("get_flems_push_secrets");
  } catch (error) {
    return json({ error: "Lecture du coffre sécurisé impossible.", details: String(error) }, 503);
  }
  if (!secrets?.cron_secret || !secrets?.vapid_private_jwk) {
    return json({ error: "Configuration sécurisée des rappels indisponible." }, 503);
  }
  if ((request.headers.get("x-cron-secret") ?? "") !== secrets.cron_secret) {
    return json({ error: "Accès non autorisé." }, 401);
  }

  let vapidPrivateKey: JsonWebKey;
  try {
    vapidPrivateKey = JSON.parse(secrets.vapid_private_jwk);
  } catch {
    return json({ error: "La clé privée VAPID stockée dans Vault est invalide." }, 503);
  }

  const today = kinshasaDate();
  let reminders: Reminder[];
  try {
    const result = await rpc<Reminder[]>("get_due_wedding_reminders", { p_today: today });
    reminders = Array.isArray(result) ? result : [];
  } catch (error) {
    return json({ error: "Lecture des rappels impossible.", details: String(error) }, 500);
  }

  let sent = 0, disabled = 0, failed = 0;
  for (const reminder of reminders) {
    const message = JSON.stringify({
      title: "Flems Center – rappel de mariage",
      body: reminder.reminder_days === 1
        ? `Plus qu’un jour avant le mariage de ${reminder.couple_name} !`
        : `Plus que ${reminder.reminder_days} jours avant le mariage de ${reminder.couple_name}.`,
      url: `?invitation=${encodeURIComponent(reminder.invitation_token)}`,
      tag: `flems-${reminder.guest_id}-J${reminder.reminder_days}`,
    });
    try {
      await send(
        { endpoint: reminder.endpoint, keys: { p256dh: reminder.p256dh, auth: reminder.auth } },
        message,
        { vapid: vapidPrivateKey, subscriber: supabaseUrl, ttl: 86400 },
      );
      await rpc("mark_guest_reminder_sent", {
        p_subscription_id: reminder.subscription_id, p_guest_id: reminder.guest_id,
        p_reminder_days: reminder.reminder_days, p_wedding_date: reminder.wedding_date,
      });
      sent++;
    } catch (error) {
      const e = error as { statusCode?: number; response?: { status?: number }; permanent?: boolean };
      const statusCode = Number(e?.statusCode ?? e?.response?.status ?? 0);
      if (statusCode === 404 || statusCode === 410 || e?.permanent) {
        try {
          await rpc("disable_guest_push_subscription", { p_subscription_id: reminder.subscription_id });
          disabled++;
        } catch {
          failed++;
        }
      } else failed++;
    }
  }
  return json({ ok: true, kinshasa_date: today, reminders_found: reminders.length, sent, disabled, failed });
});
