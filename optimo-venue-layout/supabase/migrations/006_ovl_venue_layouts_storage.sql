-- Private bucket for venue blueprint / reference images.
-- Object keys: {auth.uid()}/{templateId}/{filename}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venue-layouts',
  'venue-layouts',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "venue_layouts_storage_select_own" on storage.objects;
create policy "venue_layouts_storage_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'venue-layouts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "venue_layouts_storage_insert_own" on storage.objects;
create policy "venue_layouts_storage_insert_own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'venue-layouts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "venue_layouts_storage_update_own" on storage.objects;
create policy "venue_layouts_storage_update_own"
  on storage.objects for update to authenticated
  using (bucket_id = 'venue-layouts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'venue-layouts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "venue_layouts_storage_delete_own" on storage.objects;
create policy "venue_layouts_storage_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'venue-layouts' and (storage.foldername(name))[1] = auth.uid()::text);
