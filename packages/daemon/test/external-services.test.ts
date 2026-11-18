import { describe,it,expect,beforeEach,afterEach,vi } from "vitest";
import * as serviceModule from "../src/domain/external-services.js";
import { mkdtemp,writeFile,mkdir,rm,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRegistry,projectObservation,readExternalServices, type ExternalBinding } from "../src/domain/external-services.js";
import { createFullTestDb,createTestApp } from "./helpers/test-app.js";

const binding:ExternalBinding={key:"example",rigName:"test-services",logicalId:"planning.scheduler",host:"test-host",timer:"example.timer",service:"example.service",expectedAttachment:"external_cli"};
const bootId="12345678-1234-1234-1234-123456789abc",now=1795000000000;
function snapshot() { return {version:1,entries:[{key:binding.key,binding,bootId,observedAt:now,lastAttemptAt:now,error:null as null|string,facts:{timer:{LoadState:"loaded",ActiveState:"active",SubState:"waiting",UnitFileState:"enabled",Unit:binding.service,NextElapseUSecRealtime:(now+3600000)*1000,LastTriggerUSec:(now-3600000)*1000},service:{LoadState:"loaded",ActiveState:"inactive",SubState:"dead",UnitFileState:"static",Type:"oneshot",Result:"success",InvocationID:"0".repeat(32),ExecMainCode:1,ExecMainStatus:1,ExecMainStartTimestamp:(now-120000)*1000,ExecMainExitTimestamp:(now-60000)*1000}}}]}; }
describe("external service observations",()=>{
  it("retains nonzero exit despite reset Result and projects only reviewed fields",()=>{
    const s=snapshot();Object.assign(s.entries[0]!.facts.service,{Environment:"never project"});
    const v=projectObservation(binding,s,bootId,now);
    expect(v.availability).toBe("current");expect(v.facts?.service.ExecMainStatus).toBe(1);expect(v.facts?.service.Result).toBe("success");expect(v.facts?.service).not.toHaveProperty("Environment");
  });
  it("ages at read time, not at collector attempt time",()=>{
    const s=snapshot();expect(projectObservation(binding,s,bootId,now+180001).availability).toBe("stale");
    s.entries[0]!.error="probe_failed";s.entries[0]!.lastAttemptAt=now+120000;
    const v=projectObservation(binding,s,bootId,now+120000);expect(v.availability).toBe("unavailable");expect(v.observedAt).toBe(now);expect(v.facts).not.toBeNull();
  });
  it("first failure has no invented observation",()=>{
    const s:any=snapshot();s.entries[0].facts=null;s.entries[0].observedAt=null;s.entries[0].error="probe_failed";
    expect(projectObservation(binding,s,bootId,now)).toMatchObject({availability:"unavailable",observedAt:null,facts:null});
  });
  it.each(["boot","future","binding","duplicate","partial","timestamp","version","code"])("rejects %s invalid data",kind=>{
    const s:any=snapshot();
    if(kind==="boot")s.entries[0].bootId="old";
    if(kind==="future")s.entries[0].observedAt=now+31000;
    if(kind==="binding")s.entries[0].binding={...binding,logicalId:"other.node"};
    if(kind==="duplicate")s.entries.push(s.entries[0]);
    if(kind==="partial")delete s.entries[0].facts.service.Type;
    if(kind==="timestamp")s.entries[0].facts.service.ExecMainExitTimestamp=1;
    if(kind==="version")s.version=2;
    if(kind==="code")s.entries[0].facts.service.ExecMainCode=99;
    expect(projectObservation(binding,s,bootId,now).availability).toBe("unavailable");
  });
  it("refuses unreadable boot and duplicated/malformed registry",()=>{
    expect(projectObservation(binding,snapshot(),null,now).reason).toMatch(/boot/);
    expect(()=>parseRegistry({version:1,services:[binding,binding]})).toThrow();
    expect(()=>parseRegistry({version:1,services:[{...binding,timer:"../../secret.timer"}]})).toThrow();
  });
  it("accepts an empty unit-file state without fabricating enablement",()=>{
    const s=snapshot();s.entries[0]!.facts.service.UnitFileState="";
    expect(projectObservation(binding,s,bootId,now).availability).toBe("current");
  });
  it("does not let telemetry query failures escape into core consumers",async()=>{
    const broken={prepare:()=>{throw Error("fixture db unavailable")}};
    expect(await readExternalServices(broken as any,"id",{directory:"/unused"})).toEqual([]);
  });
});

describe("bound filesystem/API reader",()=>{
  let directory:string,db:ReturnType<typeof createFullTestDb>,setup:ReturnType<typeof createTestApp>,rigId:string;
  beforeEach(async()=>{
    directory=await mkdtemp(join(tmpdir(),"external-services-"));await mkdir(join(directory,"status"));
    db=createFullTestDb();setup=createTestApp(db);const rig=setup.rigRepo.createRig(binding.rigName);rigId=rig.id;
    const node=setup.rigRepo.addNode(rig.id,binding.logicalId,{runtime:"external_cli",cwd:"."});
    setup.sessionRegistry.registerSession(node.id,"scheduler@test-services");setup.sessionRegistry.updateBinding(node.id,{attachmentType:"external_cli"});
    await writeFile(join(directory,"registry.json"),JSON.stringify({version:1,services:[binding]}),{mode:0o644});
    await writeFile(join(directory,"status/observations.json"),JSON.stringify(snapshot()));
  });
  afterEach(async()=>{vi.restoreAllMocks();db.close();await rm(directory,{recursive:true,force:true});});
  const options=()=>({directory,bootId,now,registryOwner:process.getuid!()});
  it("maps only one current external identity without mutations",async()=>{
    const before=db.prepare("SELECT * FROM nodes").all();
    expect((await readExternalServices(db,rigId,options()))[0]?.availability).toBe("current");
    expect(db.prepare("SELECT * FROM nodes").all()).toEqual(before);
    const other=setup.rigRepo.createRig("other");expect(await readExternalServices(db,other.id,options())).toEqual([]);
    db.prepare("UPDATE bindings SET attachment_type='tmux'").run();expect(await readExternalServices(db,rigId,options())).toEqual([]);
  });
  it("omits archived and ambiguous rigs",async()=>{
    db.prepare("UPDATE rigs SET archived_at='2026-01-01' WHERE id=?").run(rigId);expect(await readExternalServices(db,rigId,options())).toEqual([]);
  });
  it("keeps service identity when observation absent and rejects symlink/oversize files",async()=>{
    await rm(join(directory,"status/observations.json"));
    expect((await readExternalServices(db,rigId,options()))[0]).toMatchObject({binding,availability:"unavailable"});
    const p=join(directory,"registry.json");await rm(p);await symlink("status/observations.json",p);
    expect(await readExternalServices(db,rigId,{...options(),now:now+3000})).toEqual([]);
    await rm(p);await writeFile(p,"x".repeat(65537));expect(await readExternalServices(db,rigId,{...options(),now:now+6000})).toEqual([]);
  });
  it("API is optional and read-only",async()=>{
    const r=await setup.app.request(`/api/rigs/${rigId}/external-services`);expect(r.status).toBe(200);expect(await r.json()).toEqual([]);
    expect((await setup.app.request(`/api/rigs/${rigId}/external-services`,{method:"POST"})).status).toBe(404);
  });
  it("adds only the mapped overlay across API, graph, inventory and detail",async()=>{
    const external=projectObservation(binding,snapshot(),bootId,now);
    vi.spyOn(serviceModule,"readExternalServices").mockResolvedValue([external]);
    const sibling=setup.rigRepo.addNode(rigId,"planning.other",{runtime:"external_cli",cwd:"."});
    const before=db.prepare("SELECT * FROM nodes ORDER BY id").all();
    expect(await (await setup.app.request(`/api/rigs/${rigId}/external-services`)).json()).toEqual([external]);
    const graph:any=await(await setup.app.request(`/api/rigs/${rigId}/graph`)).json();
    expect(graph.nodes.find((n:any)=>n.data.logicalId===binding.logicalId).data.externalService).toEqual(external);
    expect(graph.nodes.find((n:any)=>n.id===sibling.id).data.externalService).toBeUndefined();
    const inventory:any=await(await setup.app.request(`/api/rigs/${rigId}/nodes`)).json();
    expect(inventory.find((n:any)=>n.logicalId===binding.logicalId).externalService).toEqual(external);
    const detail:any=await(await setup.app.request(`/api/rigs/${rigId}/nodes/${binding.logicalId}`)).json();
    expect(detail.externalService).toEqual(external);expect(db.prepare("SELECT * FROM nodes ORDER BY id").all()).toEqual(before);
  });
});
