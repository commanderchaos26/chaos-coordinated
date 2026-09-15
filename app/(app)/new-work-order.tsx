import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Badge, Card, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { createWorkOrder } from '../../src/lib/operationsCommands';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type PropertyRow = { id: string; name: string };
type BuildingRow = { id: string; property_id: string; name: string };
type UnitRow = { id: string; property_id: string; building_id: string; unit_number: string };
type DepartmentRow = { id: string; name: string };
type SkillRow = { id: string; name: string; category: string | null };
type SiteRow = { id: string; property_id: string | null; label: string };

const allowed = (membership: Membership | null) => Boolean(membership?.roles.some((role) => ['owner','operations_manager','supervisor','dispatcher','crew_lead'].includes(role)));

export default function NewWorkOrderScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [buildings, setBuildings] = useState<BuildingRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [propertyId, setPropertyId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [roomArea, setRoomArea] = useState('');
  const [issueCategory, setIssueCategory] = useState('');
  const [priority, setPriority] = useState<'low'|'normal'|'high'|'emergency'>('normal');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [occupancyBlocking, setOccupancyBlocking] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const current = await loadMembership();
        setMembership(current);
        if (!current) return;
        const [p,b,u,d,s,ws] = await Promise.all([
          supabase.from('properties').select('id,name').eq('company_id',current.companyId).eq('active',true).order('name'),
          supabase.from('buildings').select('id,property_id,name').eq('company_id',current.companyId).eq('active',true).order('name'),
          supabase.from('units').select('id,property_id,building_id,unit_number').eq('company_id',current.companyId).eq('active',true).order('unit_number'),
          supabase.from('departments').select('id,name').eq('company_id',current.companyId).eq('active',true).order('name'),
          supabase.from('skills').select('id,name,category').eq('company_id',current.companyId).eq('active',true).order('name'),
          supabase.from('work_sites').select('id,property_id,label').eq('company_id',current.companyId).eq('active',true).order('label'),
        ]);
        const failed=[p,b,u,d,s,ws].find((result)=>result.error); if(failed?.error) throw failed.error;
        setProperties((p.data??[]) as PropertyRow[]); setBuildings((b.data??[]) as BuildingRow[]); setUnits((u.data??[]) as UnitRow[]); setDepartments((d.data??[]) as DepartmentRow[]); setSkills((s.data??[]) as SkillRow[]); setSites((ws.data??[]) as SiteRow[]);
      } catch (cause) { Alert.alert('Could not load work-order setup', cause instanceof Error ? cause.message : 'Unknown error'); }
      finally { setLoading(false); }
    };
    void load();
  }, []);

  const visibleBuildings = useMemo(()=>buildings.filter((b)=>b.property_id===propertyId),[buildings,propertyId]);
  const visibleUnits = useMemo(()=>units.filter((u)=>u.property_id===propertyId && (!buildingId || u.building_id===buildingId)),[units,propertyId,buildingId]);
  const visibleSites = useMemo(()=>sites.filter((s)=>s.property_id===propertyId),[sites,propertyId]);

  const submit = async () => {
    if (!membership || saving) return;
    if (!propertyId) { Alert.alert('Property required','Choose the property for this work order.'); return; }
    if (!title.trim()) { Alert.alert('Title required','Enter a clear work-order title.'); return; }
    let dueIso: string | null = null;
    if (dueAt.trim()) { const parsed = new Date(dueAt); if (Number.isNaN(parsed.getTime())) { Alert.alert('Invalid due date','Use a valid date/time, for example 2026-09-20T16:00:00.'); return; } dueIso=parsed.toISOString(); }
    const minutes = estimatedMinutes.trim() ? Number(estimatedMinutes) : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) { Alert.alert('Invalid estimate','Estimated minutes must be greater than zero.'); return; }
    setSaving(true);
    try {
      const skillSnapshot = selectedSkills.map((id)=>{ const skill=skills.find((item)=>item.id===id); return { skill_id:id, name:skill?.name ?? 'Skill', category:skill?.category ?? null }; });
      await createWorkOrder({ p_company_id:membership.companyId,p_property_id:propertyId,p_title:title.trim(),p_building_id:buildingId||null,p_unit_id:unitId||null,p_turnover_id:null,p_work_site_id:siteId||null,p_department_id:departmentId||null,p_description:description.trim()||null,p_room_area:roomArea.trim()||null,p_issue_category:issueCategory.trim()||null,p_required_skill_snapshot:skillSnapshot,p_priority:priority,p_occupancy_blocking:occupancyBlocking,p_blocking_phase:null,p_estimated_minutes:minutes,p_due_at:dueIso,p_source_type:'manual' });
      Alert.alert('Work order created','The work order is now available for dispatch.',[{text:'OK',onPress:()=>router.replace('/(app)/work-orders' as never)}]);
    } catch (cause) { Alert.alert('Could not create work order', cause instanceof Error ? cause.message : 'Unknown error'); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingScreen label="Preparing work order..." />;
  if (!allowed(membership)) return <View style={styles.locked}><Icon name="lock-closed-outline" color={colors.amber} size={26}/><Text style={styles.lockedTitle}>Work-order creation access required</Text><Text style={styles.help}>Owner, Operations Manager, Supervisor, Dispatcher, or Crew Lead can create work orders.</Text></View>;

  return <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Pressable onPress={()=>router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={22}/></Pressable><View><Text style={styles.eyebrow}>FIELD OPERATIONS</Text><Text style={styles.title}>New work order</Text></View></View>
    {!properties.length ? <Card style={styles.warning}><Text style={styles.warningTitle}>Create a property first</Text><Text style={styles.help}>Work orders need a real property. Set up the property, buildings, units, and geofence first.</Text><Pressable onPress={()=>router.push('/(app)/properties' as never)} style={styles.secondary}><Text style={styles.secondaryText}>Open property setup</Text></Pressable></Card> : null}
    <Section title="Location"><Label text="PROPERTY"/><Chips items={properties.map((x)=>({id:x.id,label:x.name}))} selected={propertyId} onSelect={(id)=>{setPropertyId(id);setBuildingId('');setUnitId('');setSiteId('');}}/><Label text="BUILDING (OPTIONAL FOR PROPERTY-WIDE WORK)"/><Chips items={visibleBuildings.map((x)=>({id:x.id,label:x.name}))} selected={buildingId} onSelect={(id)=>{setBuildingId(id);setUnitId('');}}/><Label text="UNIT (LEAVE BLANK FOR HALLWAY / COMMON AREA)"/><Chips items={visibleUnits.map((x)=>({id:x.id,label:x.unit_number}))} selected={unitId} onSelect={setUnitId}/>{visibleSites.length ? <><Label text="WORKSITE / GEOFENCE"/><Chips items={visibleSites.map((x)=>({id:x.id,label:x.label}))} selected={siteId} onSelect={setSiteId}/></> : null}</Section>
    <Section title="Work details"><Field label="TITLE" value={title} onChangeText={setTitle} placeholder="Example: Repair leaking kitchen sink"/><Field label="DESCRIPTION" value={description} onChangeText={setDescription} placeholder="Describe the issue and expected result" multiline/><Field label="ROOM / AREA" value={roomArea} onChangeText={setRoomArea} placeholder="Kitchen, bedroom 2, hallway…"/><Field label="ISSUE CATEGORY" value={issueCategory} onChangeText={setIssueCategory} placeholder="Plumbing, damage, cleaning…"/></Section>
    <Section title="Department & skills"><Label text="DEPARTMENT"/><Chips items={departments.map((x)=>({id:x.id,label:x.name}))} selected={departmentId} onSelect={setDepartmentId}/><Label text="REQUIRED SKILLS"/><View style={styles.chips}>{skills.length ? skills.map((skill)=>{const active=selectedSkills.includes(skill.id);return <Pressable key={skill.id} onPress={()=>setSelectedSkills(active?selectedSkills.filter((id)=>id!==skill.id):[...selectedSkills,skill.id])} style={[styles.chip,active&&styles.chipActive]}><Text style={[styles.chipText,active&&styles.chipTextActive]}>{skill.name}</Text></Pressable>}) : <Text style={styles.help}>No company skills configured. The work order can still be routed by department.</Text>}</View></Section>
    <Section title="Priority & schedule"><Label text="PRIORITY"/><Chips items={['low','normal','high','emergency'].map((x)=>({id:x,label:x.toUpperCase()}))} selected={priority} onSelect={(id)=>setPriority(id as typeof priority)}/><Field label="DUE DATE / TIME (OPTIONAL)" value={dueAt} onChangeText={setDueAt} placeholder="2026-09-20T16:00:00"/><Field label="ESTIMATED MINUTES (OPTIONAL)" value={estimatedMinutes} onChangeText={setEstimatedMinutes} placeholder="60" keyboardType="numeric"/><View style={styles.switchRow}><View style={styles.flex}><Text style={styles.switchTitle}>Occupancy blocking</Text><Text style={styles.help}>Turn on when this issue prevents the unit from being ready for occupancy.</Text></View><Switch value={occupancyBlocking} onValueChange={setOccupancyBlocking} trackColor={{true:colors.tealDeep}} thumbColor={occupancyBlocking?colors.teal:colors.muted}/></View></Section>
    <Pressable disabled={saving||!properties.length} onPress={()=>void submit()} style={[styles.create,saving&&styles.disabled]}><Icon name="construct-outline" color={colors.background} size={20}/><Text style={styles.createText}>{saving?'Creating…':'Create work order'}</Text></Pressable>
  </ScrollView>;
}

function Section({title,children}:{title:string;children:React.ReactNode}){return <Card style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</Card>}
function Label({text}:{text:string}){return <Text style={styles.label}>{text}</Text>}
function Chips({items,selected,onSelect}:{items:{id:string;label:string}[];selected:string;onSelect:(id:string)=>void}){return <View style={styles.chips}>{items.length?items.map((item)=><Pressable key={item.id} onPress={()=>onSelect(item.id===selected?'':item.id)} style={[styles.chip,item.id===selected&&styles.chipActive]}><Text style={[styles.chipText,item.id===selected&&styles.chipTextActive]}>{item.label}</Text></Pressable>):<Text style={styles.help}>None available.</Text>}</View>}
function Field({label,value,onChangeText,placeholder,multiline,keyboardType}:{label:string;value:string;onChangeText:(value:string)=>void;placeholder:string;multiline?:boolean;keyboardType?:'default'|'numeric'}){return <View style={styles.field}><Label text={label}/><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.subtle} multiline={multiline} keyboardType={keyboardType} textAlignVertical={multiline?'top':'center'} style={[styles.input,multiline&&styles.multiline]}/></View>}

const styles=StyleSheet.create({root:{backgroundColor:colors.background,gap:spacing.lg,padding:spacing.lg,paddingBottom:120},header:{alignItems:'center',flexDirection:'row',gap:spacing.md,paddingTop:spacing.sm},back:{alignItems:'center',backgroundColor:colors.surface,borderColor:colors.border,borderRadius:14,borderWidth:1,height:46,justifyContent:'center',width:46},eyebrow:{color:colors.teal,fontSize:11,fontWeight:'800',letterSpacing:1.1},title:{color:colors.text,...typography.title,marginTop:3},section:{gap:spacing.md},sectionTitle:{color:colors.text,fontSize:18,fontWeight:'900'},label:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.7},chips:{flexDirection:'row',flexWrap:'wrap',gap:spacing.sm},chip:{backgroundColor:colors.surfaceSoft,borderColor:colors.border,borderRadius:12,borderWidth:1,paddingHorizontal:spacing.md,paddingVertical:spacing.sm},chipActive:{backgroundColor:colors.tealDeep,borderColor:colors.teal},chipText:{color:colors.muted,fontSize:13,fontWeight:'800'},chipTextActive:{color:colors.teal},field:{gap:spacing.sm},input:{backgroundColor:colors.surfaceRaised,borderColor:colors.border,borderRadius:12,borderWidth:1,color:colors.text,fontSize:15,minHeight:50,paddingHorizontal:spacing.md},multiline:{minHeight:110,paddingTop:spacing.md},switchRow:{alignItems:'center',flexDirection:'row',gap:spacing.md},switchTitle:{color:colors.text,fontSize:14,fontWeight:'800'},help:{color:colors.muted,fontSize:12,lineHeight:18},flex:{flex:1},create:{alignItems:'center',backgroundColor:colors.teal,borderRadius:15,flexDirection:'row',gap:spacing.sm,justifyContent:'center',minHeight:58},createText:{color:colors.background,fontSize:16,fontWeight:'900'},disabled:{opacity:.5},warning:{backgroundColor:colors.amberDeep,gap:spacing.md},warningTitle:{color:colors.text,fontSize:16,fontWeight:'900'},secondary:{alignItems:'center',backgroundColor:colors.surfaceSoft,borderColor:colors.border,borderRadius:12,borderWidth:1,minHeight:46,justifyContent:'center'},secondaryText:{color:colors.text,fontWeight:'800'},locked:{alignItems:'center',backgroundColor:colors.background,flex:1,justifyContent:'center',padding:spacing.xxl},lockedTitle:{color:colors.text,fontSize:18,fontWeight:'900',marginTop:spacing.md}});
