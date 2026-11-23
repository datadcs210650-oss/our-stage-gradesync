import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'osc-console.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261123160000_change_only_osc_score_realtime.sql'),'utf8');
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('OSC embedded console listens for Supabase score-change events, never polls for score data',()=>{
 assert.match(html,/postgres_changes/);
 assert.match(html,/table:"gs_change_signal"/);
 assert.match(html,/changeSignalWatchers=new Map\(\)/);
 assert.match(html,/watchChangeSignals\(T\(ref\.table\),schedule,onError\)/);
 assert.doesNotMatch(html,/setTimeout\(update,document\.hidden\?30000:5000\)/);
 assert.match(html,/function onSnapshot\(ref,next,onError\)/);
 assert.match(html,/if\(first\|\|changes\.length\)/);
 assert.match(html,/release\(\);document\.removeEventListener\("visibilitychange",foreground\)/);
});

test('only a public empty-data change signal is available to anonymous Realtime listeners',()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.gs_change_signal/);
 assert.match(migration,/scope text PRIMARY KEY/);
 assert.match(migration,/version bigint NOT NULL DEFAULT 0/);
 assert.doesNotMatch(migration,/grader_name|candidate_id|score_value|student_name/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/GRANT SELECT ON public\.gs_change_signal TO anon, authenticated/);
 assert.doesNotMatch(migration,/GRANT (INSERT|UPDATE|DELETE).*TO anon/);
 assert.match(migration,/ALTER PUBLICATION supabase_realtime ADD TABLE public\.gs_change_signal/);
 assert.match(migration,/SECURITY DEFINER SET search_path=''/);
 assert.match(migration,/REVOKE ALL ON FUNCTION gradesync_internal\.emit_change_signal\(\) FROM PUBLIC, anon, authenticated/);
});

test('actual grader score writes remain direct Supabase operations with their own realtime',()=>{
 assert.match(original,/createClient\(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY/);
 assert.match(original,/supabase\.channel\("gs_"/);
 assert.match(original,/event:"\*",schema:"public",table:t/);
});
