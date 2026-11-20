import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const APP_URL = "https://guystamandwa-ops.github.io/flems-center-wedding-planner/";
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://guystamandwa-ops.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function readJson(response: Response): Promise<any> {
  const body = await response.text();
  let parsed: any = {};
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { message: body }; }
  if (!response.ok) {
    const message = parsed.msg || parsed.message || parsed.error_description || parsed.error || response.statusText;
    throw new Error(String(message));
  }
  return parsed;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply({ error: "Méthode non autorisée." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const incomingApiKey = request.headers.get("apikey") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  let serviceKey = "";
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    serviceKey = keys.default ?? "";
  } catch { serviceKey = ""; }
  if (!supabaseUrl || !incomingApiKey || !authorization || !serviceKey) {
    return reply({ error: "Configuration du service indisponible." }, 503);
  }

  // Vérifier l'identité de la personne connectée avec son propre jeton.
  let caller: any;
  try {
    caller = await readJson(await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: incomingApiKey, Authorization: authorization },
    }));
  } catch {
    return reply({ error: "Connexion invalide ou expirée. Reconnecte-toi." }, 401);
  }
  if (!caller?.id) return reply({ error: "Connexion requise." }, 401);

  const adminHeaders = { apikey: serviceKey, "Content-Type": "application/json" };
  async function adminFetch(path: string, init: RequestInit = {}): Promise<any> {
    return await readJson(await fetch(`${supabaseUrl}${path}`, {
      ...init,
      headers: { ...adminHeaders, ...(init.headers as Record<string, string> ?? {}) },
    }));
  }

  // Seul le propriétaire Flems Center peut gérer les comptes.
  let profiles: any[];
  try {
    profiles = await adminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(caller.id)}&select=role,full_name&limit=1`);
  } catch {
    return reply({ error: "Vérification du profil impossible." }, 503);
  }
  if (!Array.isArray(profiles) || profiles[0]?.role !== "owner") {
    return reply({ error: "Cette action est réservée à l’administrateur Flems Center." }, 403);
  }

  let body: any;
  try { body = await request.json(); } catch { return reply({ error: "Données invalides." }, 400); }
  const action = String(body?.action ?? "");

  if (action === "list_employees") {
    try {
      const employees = await adminFetch("/rest/v1/profiles?select=id,full_name&role=eq.employee&order=full_name.asc");
      return reply({ ok: true, employees: Array.isArray(employees) ? employees : [] });
    } catch (error) {
      return reply({ error: String(error) }, 500);
    }
  }

  if (action !== "invite_client" && action !== "invite_employee") {
    return reply({ error: "Action inconnue." }, 400);
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const fullName = String(body?.full_name ?? "").trim();
  const coupleId = String(body?.couple_id ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: "Adresse e-mail invalide." }, 400);
  if (fullName.length < 2 || fullName.length > 100) return reply({ error: "Le nom doit contenir entre 2 et 100 caractères." }, 400);
  if (action === "invite_client" && !/^[0-9a-f-]{36}$/i.test(coupleId)) return reply({ error: "Choisis le mariage à associer à ce client." }, 400);

  if (action === "invite_client") {
    try {
      const couples = await adminFetch(`/rest/v1/couples?id=eq.${encodeURIComponent(coupleId)}&select=id,client_user_id&limit=1`);
      if (!Array.isArray(couples) || !couples.length) return reply({ error: "Mariage introuvable." }, 404);
      if (couples[0].client_user_id) return reply({ error: "Un compte client est déjà associé à ce mariage." }, 409);
    } catch (error) {
      return reply({ error: "Vérification du mariage impossible : " + String(error) }, 500);
    }
  }

  // L'invitation est envoyée par Supabase Auth. Le lien revient vers l'application officielle.
  let invited: any;
  const legacyServiceRoleJwt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!legacyServiceRoleJwt) {
    return reply({ error: "Le service d’invitation administrateur n’est pas configuré." }, 503);
  }
  try {
    // L’API Auth Admin exige un JWT service_role dans Authorization.
    // La clé secrète moderne reste dans apikey pour les appels Data API.
    invited = await readJson(await fetch(
      `${supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(APP_URL)}`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${legacyServiceRoleJwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, data: { full_name: fullName } }),
      },
    ));
  } catch (error) {
    return reply({ error: "Invitation non envoyée : " + String(error) }, 400);
  }
  const invitedUserId = invited?.id ?? invited?.user?.id;
  if (!invitedUserId) return reply({ error: "Supabase n’a pas retourné l’identifiant du compte invité." }, 502);

  try {
    await adminFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(invitedUserId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ full_name: fullName, role: action === "invite_client" ? "client" : "employee" }),
    });
    if (action === "invite_client") {
      await adminFetch(`/rest/v1/couples?id=eq.${encodeURIComponent(coupleId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ client_user_id: invitedUserId }),
      });
    }
  } catch (error) {
    return reply({
      error: "Le compte a été invité, mais son rattachement n’a pas été terminé. Contacte l’administrateur avant de renvoyer une invitation.",
      account_created: true,
      details: String(error),
    }, 500);
  }

  return reply({
    ok: true,
    message: action === "invite_client"
      ? "Invitation envoyée. Le compte client est associé au mariage."
      : "Invitation envoyée. Le compte employé est prêt à recevoir des tâches.",
    user_id: invitedUserId,
  });
});
