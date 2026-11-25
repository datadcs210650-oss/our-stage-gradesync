begin;

do $fixture$
declare j uuid:=gen_random_uuid(); unused uuid:=gen_random_uuid(); old_group uuid:=gen_random_uuid();
 new_group uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid(); score_id uuid;
 casting uuid:=gen_random_uuid(); quorum_before jsonb; quorum_after jsonb; removable uuid:=gen_random_uuid(); original_assignment uuid;
 receipt_code text:=(10000000+floor(random()*90000000))::int::text;
begin
 insert into auth.users(id,email) values(j,j||'@example.invalid'),(unused,unused||'@example.invalid');
 insert into public.gs_castings(id,term,name,status) values(casting,'FA26','Fixture casting','draft');
 insert into public.competition_groups(id,name,criteria) values
 (old_group,'Fixture old','[{"name":"A","weight":50},{"name":"B","weight":50}]'),
 (new_group,'Fixture new','[{"name":"A","weight":100}]'),
 (removable,'Fixture removable','[{"name":"A","weight":100}]');
 update public.competition_groups set casting_id=casting where id in (old_group,new_group);
 insert into public.profiles(id,name,role,status,assigned_groups) values
 (j,'Fixture judge','Grader','Active',array[old_group,removable]),
 (unused,'Fixture unused','Grader','Active',array[removable]);
 perform public.osc_update_grader(j,'Fixture judge',array[old_group,removable],true,j||'@example.invalid',false);
 perform public.osc_set_grader_criteria(j,old_group,array['A']);
 perform public.osc_set_grader_criteria(j,removable,array['A']);
 select id into strict original_assignment from public.grader_assignments where grader_id=j and group_id=old_group;
 insert into public.candidates(id,group_id,name,code) values(candidate,old_group,'Fixture candidate','FIXTURE');
 insert into public.scores(candidate_id,group_id,grader_id,scores,total_score,locked)
 values(candidate,old_group,j,'{"A":8}',8,true) returning id into score_id;
 insert into public.grader_verifications(group_id,grader_id,is_verified) values(old_group,j,true);
 select to_jsonb(q) into strict quorum_before from public.osc_candidate_quorum(casting) q where q.candidate_id=candidate;
 insert into gradesync_internal.comparison_code_registry(code,grader_id,group_id) values(receipt_code,j,old_group);
 perform public.osc_update_grader(j,'Fixture updated',array[old_group,new_group],true,j||'@example.invalid',false);
 if not exists(select 1 from public.grader_assignments where id=original_assignment)
    or not exists(select 1 from public.grader_assignments where grader_id=j and group_id=new_group)
    or exists(select 1 from public.grader_assignments where grader_id=j and group_id=removable)
    or exists(select 1 from public.gs_criterion_grants where grader_id=j and group_id=removable)
 then raise exception 'Assignment delta failed'; end if;
 begin
  perform public.osc_update_grader(j,'Unexpected',array[new_group],false,null,false);
  raise exception 'Expected roster protection';
 exception when raise_exception then if sqlerrm<>'GS_QUORUM_ROSTER_LOCKED' then raise; end if;
 end;
 begin
  perform public.osc_update_grader(j,'Unexpected',array[old_group,new_group],true,'changed@example.invalid',true);
  raise exception 'Expected identity protection';
 exception when raise_exception then if sqlerrm<>'GS_JUDGE_EMAIL_LOCKED' then raise; end if;
 end;
 begin
  perform public.osc_set_grader_criteria(j,old_group,array['B']);
  raise exception 'Expected criteria protection';
 exception when raise_exception then if sqlerrm<>'GS_CRITERIA_HISTORY' then raise; end if;
 end;
 begin
  delete from auth.users where id=j;
  raise exception 'Expected cascade protection';
 exception when raise_exception then if sqlerrm<>'GS_GRADER_HISTORY' then raise; end if;
 end;
 perform public.osc_archive_grader(j,'fixture');
 select to_jsonb(q) into strict quorum_after from public.osc_candidate_quorum(casting) q where q.candidate_id=candidate;
 if quorum_before<>quorum_after then raise exception 'Archiving changed quorum'; end if;
 if not exists(select 1 from public.profiles where id=j and status='Active' and name='Fixture updated')
    or not exists(select 1 from public.gs_google_grader_access where profile_id=j and enabled=false and email=j||'@example.invalid')
    or not exists(select 1 from public.gs_criterion_grants where grader_id=j and group_id=old_group and criterion='A')
    or not exists(select 1 from gradesync_internal.comparison_code_registry where code=receipt_code)
    or not exists(select 1 from public.scores where id=score_id and total_score=8)
 then raise exception 'Archive changed history or access stayed enabled'; end if;
 begin
  update public.gs_google_grader_access set enabled=true where profile_id=j;
  raise exception 'Expected archived access protection';
 exception when raise_exception then if sqlerrm<>'GS_GRADER_ARCHIVED' then raise; end if;
 end;
 begin
  perform public.osc_superadmin_delete_session(old_group,'Fixture old','fixture');
  raise exception 'Expected session history protection';
 exception when raise_exception then if sqlerrm<>'GS_SESSION_DELETE_PROTECTED' then raise; end if;
 end;
 delete from auth.users where id=unused;
 if exists(select 1 from public.profiles where id=unused) then raise exception 'Unused judge delete failed'; end if;
 insert into auth.users(id,email) values(unused,unused||'@example.invalid');
 insert into public.profiles(id,name,role,status,assigned_groups) values(unused,'Fixture other judge','Grader','Active',array[removable]);
 perform set_config('fixture.unused',unused::text,true);
 perform set_config('fixture.removable',removable::text,true);
 perform set_config('fixture.new',new_group::text,true);
end
$fixture$;
set local role service_role;
do $service$
begin
 perform public.osc_superadmin_delete_session(current_setting('fixture.removable')::uuid,'Fixture removable','fixture');
 if exists(select 1 from public.competition_groups where id=current_setting('fixture.removable')::uuid)
 then raise exception 'Unused session delete failed'; end if;
 if exists(select 1 from public.profiles where id=current_setting('fixture.unused')::uuid
     and current_setting('fixture.removable')::uuid=any(assigned_groups))
 then raise exception 'Deleted session remained in profile metadata'; end if;
 if not exists(select 1 from public.competition_groups where id=current_setting('fixture.new')::uuid)
 then raise exception 'New casting session was lost'; end if;
end
$service$;
reset role;

rollback;
