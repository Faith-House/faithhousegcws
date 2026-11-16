import { Annotation, StateGraph, START, END } from '@langchain/langgraph';

const State=Annotation.Root({destination:Annotation(),handled:Annotation()});
const allowedRoutes=new Set(['actions','conversation','ignore']);

// Per-invocation callbacks stay out of graph state. Existing stores own bounded
// room/profile and Discord-channel history. No checkpoint replays a device write.
export function createAgentHarness({name='household',now=Date.now}={}) {
  const recent=[];
  async function step(label,state,config) {
    const {handlers,report}=config.configurable;
    config.signal?.throwIfAborted();
    if(handlers.isCurrent&&!handlers.isCurrent())throw Error('Request was replaced.');
    report.steps.push(label);report.stage=label;
    const result=await handlers[label]?.(state);
    config.signal?.throwIfAborted();
    if(label==='route'){
      if(!allowedRoutes.has(result))throw Error('Unknown agent route.');
      report.route=result;return{destination:result};
    }
    return label==='actions'?{handled:result===true}:{};
  }
  const graph=new StateGraph(State)
    .addNode('prepare',(state,config)=>step('prepare',state,config))
    .addNode('route',(state,config)=>step('route',state,config))
    .addNode('actions',(state,config)=>step('actions',state,config))
    .addNode('conversation',(state,config)=>step('conversation',state,config))
    .addNode('complete',(state,config)=>step('complete',state,config))
    .addEdge(START,'prepare').addEdge('prepare','route')
    .addConditionalEdges('route',state=>state.destination,{actions:'actions',conversation:'conversation',ignore:END})
    .addConditionalEdges('actions',state=>state.handled?'complete':'conversation',{complete:'complete',conversation:'conversation'})
    .addEdge('conversation','complete').addEdge('complete',END).compile();

  async function run({requestId,sessionKey},handlers,{signal}={}) {
    const report={requestId,sessionKey,startedAt:now(),stage:'starting',route:null,steps:[],status:'running'};
    recent.push(report);if(recent.length>20)recent.shift();
    try {
      await graph.invoke({destination:'ignore',handled:false},{signal,recursionLimit:10,callbacks:[],configurable:{handlers,report}});
      report.status='completed';
    }catch(error){report.status=signal?.aborted?'cancelled':'failed';throw error;}
    finally{report.finishedAt=now();}
    return{...report,steps:[...report.steps]};
  }
  return{run,status:()=>({engine:'LangGraph.js',name,local:true,checkpointing:false,automaticActionRetries:false,recent:recent.map(item=>({...item,steps:[...item.steps]}))})};
}
