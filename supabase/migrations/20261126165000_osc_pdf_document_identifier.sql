alter table public.osc_grading_pdf_issues add column if not exists document_id uuid;
create unique index if not exists osc_grading_pdf_document_id_idx on public.osc_grading_pdf_issues(document_id) where document_id is not null;
notify pgrst,'reload schema';