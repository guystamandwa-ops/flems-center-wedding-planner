alter table public.guestbook_photos
  add column if not exists published boolean not null default true;

create or replace function public.get_guest_invitation(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
 v_guest_name text; v_couple_id uuid; v_selected_option uuid; v_table text; v_rsvp text;
 v_couple_name text; v_wedding_date date; v_venue text; v_theme_color text; v_guestbook_token uuid;
 v_options jsonb; v_photos jsonb;
begin
 select g.full_name,g.couple_id,g.beverage_option_id,g.table_number,g.rsvp
 into v_guest_name,v_couple_id,v_selected_option,v_table,v_rsvp
 from public.guests g where g.invitation_token=p_token;
 if not found then return jsonb_build_object('ok',false,'message','Invitation introuvable ou invalide.'); end if;
 select c.couple_name,c.wedding_date,c.venue,c.theme_color,c.guestbook_token
 into v_couple_name,v_wedding_date,v_venue,v_theme_color,v_guestbook_token
 from public.couples c where c.id=v_couple_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.name),'[]'::jsonb)
 into v_options from public.beverage_options b where b.couple_id=v_couple_id and b.active=true;
 select coalesce(jsonb_agg(jsonb_build_object('public_url',p.public_url,'caption',p.caption) order by p.created_at),'[]'::jsonb)
 into v_photos from public.guestbook_photos p where p.couple_id=v_couple_id and p.published=true;
 return jsonb_build_object('ok',true,'guest_name',v_guest_name,'couple_name',v_couple_name,
  'wedding_date',v_wedding_date,'venue',v_venue,'theme_color',v_theme_color,'guestbook_token',v_guestbook_token,
  'table_number',v_table,'rsvp',coalesce(v_rsvp,'En attente'),'photos',v_photos,
  'selected_beverage_option_id',v_selected_option,'options',v_options);
end;
$function$;

create or replace function public.submit_guest_rsvp(p_token uuid, p_rsvp text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_guest_id uuid;
begin
 if p_rsvp not in ('Présent','Absent','En attente') then
  return jsonb_build_object('ok',false,'message','Réponse non valide.');
 end if;
 update public.guests set rsvp=p_rsvp
 where invitation_token=p_token returning id into v_guest_id;
 if v_guest_id is null then
  return jsonb_build_object('ok',false,'message','Invitation introuvable ou invalide.');
 end if;
 return jsonb_build_object('ok',true,'rsvp',p_rsvp,'message','Votre réponse a bien été enregistrée.');
end;
$function$;

revoke all on function public.submit_guest_rsvp(uuid,text) from public;
revoke all on function public.submit_guest_rsvp(uuid,text) from anon, authenticated;
grant execute on function public.submit_guest_rsvp(uuid,text) to anon, authenticated;
