/** Transport fixtures only: independently authored, no constructor helper imports. Not live model evidence. */
const source = (quote) => ({ quote, start: null, end: null });
const money = (counted_object = null) => ({ kind: 'currency', currency: 'GBP', period: 'month', counted_object, as_stated: '£ a month' });
const quantity = (ref, entity_ref, role, literal, value, quote, unit, extra = {}) => ({ ref, entity_ref, role, number: { literal, value, source: source(quote) }, unit, frame: 'level', direction: 'none', comparator: null, horizon_months: null, ...extra });
export function sourceMeaningFixture() {
  return {
    entities: [
      { ref: 'price', kind: 'factor', label: 'Pro plan price', source: source('Pro plan price from £49 to £59 a month') },
      { ref: 'subscribers', kind: 'factor', label: 'Paying subscribers', source: source('1,500 paying subscribers') },
      { ref: 'mrr', kind: 'goal', label: 'MRR', source: source('£75k MRR') },
      { ref: 'churn', kind: 'factor', label: 'Monthly churn', source: source('Monthly churn must stay below 5%') },
      { ref: 'raise', kind: 'option', label: 'Raise Pro price to £59', source: source('raise our Pro plan price from £49 to £59 a month') },
    ],
    quantities: [
      quantity('current_price','price','current','£49','49','Pro plan price from £49 to £59 a month',money('subscriber')),
      quantity('current_subscribers','subscribers','current','1,500','1500','1,500 paying subscribers',{ kind: 'count', currency: null, period: null, counted_object: 'subscribers', as_stated: 'subscribers' }),
      quantity('current_mrr','mrr','current','£75k','75000','£75k MRR',money()),
      quantity('target_mrr','mrr','target','£85k','85000','we want MRR above £85k within a year',money(),{comparator:'>',horizon_months:12}),
      quantity('raised_price','price','proposed_level','£59','59','Pro plan price from £49 to £59 a month',money('subscriber')),
      quantity('churn_limit','churn','limit','5%','5','Monthly churn must stay below 5%',{kind:'percent',currency:null,period:'month',counted_object:null,as_stated:'%'},{comparator:'<'}),
    ],
    options: [{ entity_ref: 'raise', is_status_quo: false, interventions: [{ entity_ref: 'price', quantity_ref: 'raised_price', source: source('Pro plan price from £49 to £59 a month') }] }],
    definitions: [], causal_claims: [], proposals: [],
    unknowns: [{ ref: 'revenue_scope', entity_refs: ['mrr','price','subscribers'], question: 'Does £75k MRR include other plans? £49 times 1,500 is £73,500.', source: source('1,500 paying subscribers and £75k MRR') }],
  };
}
export function candidateFixture() {
  return {
    decision: { label: 'Raise Pro plan price?', provenance: 'explicit' },
    goal: { metric:'MRR', operator:'>', value:85000, unit:'GBP per month', horizon_months:12, provenance:'explicit', baseline_known:true, baseline_value:75000, baseline_provenance:'explicit', frame:'level', scope:{modelled:'all plans',alternative:'Pro plan only',stated_in_brief:false} },
    constraints:[{metric:'Monthly churn',operator:'<',value:5,unit:'%',provenance:'explicit',frame:'level'}],
    options:[{label:'Raise Pro price to £59',provenance:'explicit',source_quote:'raise our Pro plan price from £49 to £59 a month',is_status_quo:false,interventions:[{factor_label:'Pro plan price',value:59,unit:'GBP per month',provenance:'explicit'}],changes:[]}],
    factors:[{label:'Pro plan price',role:'controllable',baseline_known:true,baseline_value:49,unit:'GBP per month',provenance:'explicit'}, {label:'Paying subscribers',role:'observable',baseline_known:true,baseline_value:1500,unit:'subscribers',provenance:'explicit'}, {label:'Monthly churn',role:'observable',baseline_known:false,baseline_value:null,unit:'%',provenance:'explicit'}],
    risks:[],outcomes:[],definitions:[],
    links:[{from:'Pro plan price',to:'MRR',direction:'positive',provenance:'inferred'},{from:'Paying subscribers',to:'MRR',direction:'positive',provenance:'inferred'},{from:'Pro plan price',to:'Monthly churn',direction:'unknown',provenance:'inferred'}],
    unknowns:[{what:'Revenue scope',why:'£49 times 1,500 is £73,500, not £75k.',how_to_resolve:'Does MRR include other plans?'}],
  };
}
export function providerFixtureResponse(body, { arm, brief, registered }) {
  let output;
  if (body.text?.format?.type === 'json_schema') {
    const text = JSON.stringify(arm === 'source_first' ? sourceMeaningFixture() : candidateFixture());
    output=[{type:'message',id:'fixture-message',role:'assistant',status:'completed',content:[{type:'output_text',text}]}];
  } else if (!registered) {
    output=[{type:'function_call',id:'fixture-build',call_id:'fixture-build-call',name:'build_model_from_brief',arguments:JSON.stringify({brief})}];
  } else {
    output=[{type:'message',id:'fixture-narration',role:'assistant',status:'completed',content:[{type:'output_text',text:'Your model preserves the supplied values. Does £75k MRR include other plans? £49 times 1,500 is £73,500.'}]}];
  }
  return new Response(JSON.stringify({id:'fixture-response',object:'response',status:'completed',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{status:200,headers:{'content-type':'application/json'}});
}
