import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRequirements} from '../worker/advisor.js';
import {candidateContext,controls,factualEvidence} from '../worker/conversation.js';

test('buyer assertions distinguish changes, hypotheses, negation and third-party quotes',()=>{
 const before={profile:{budget:300},requirements:{roomCount:2}};
 for(const text of ['如果预算到350万会怎样','朋友预算是500万','不是预算350万','不要改预算350万','学区是什么','不投资'])assert.deepEqual(extractRequirements(text,before),before,text);
 assert.equal(extractRequirements('预算改成280万',before).profile.budget,280);
 assert.equal(extractRequirements('清空预算',before).profile.budget,null);
 assert.equal(extractRequirements('必须有电梯').requirements.needElevator,true);
 assert.equal(extractRequirements('最好有电梯').requirements.needElevator,undefined);
 assert.equal(extractRequirements('没有电梯也可以').requirements.needElevator,null);
 const collected=extractRequirements('预算300万，想要两室，但每天上班太远受不了');
 assert.equal(collected.profile.budget,300);assert.equal(collected.requirements.roomCount,2);
});
test('defer and resume require explicit named field intent',()=>{
 assert.deepEqual(controls('首付暂时不想说，先给我看看').deferred,['downPayment']);
 assert.deepEqual(controls('不知道',undefined,'首付大概准备多少？').deferred,['downPayment']);
 assert.deepEqual(controls('现在继续说首付').resumed,['downPayment']);
 assert.deepEqual(controls('如果清空预算会怎样').clear,[]);
 assert.equal(factualEvidence('朋友的售价500万元','500万元'),false);
 assert.equal(factualEvidence('如果改成350万元会怎样','350万元'),false);
 assert.equal(factualEvidence('售价改成350万元','350万元'),true);
});
test('partial browsing uses actual candidates, preserves hard limits and separates a hypothetical budget',()=>{
 const data={profile:{budget:300},requirements:{roomCount:2,needElevator:true}};
 const rows=[{id:'a',totalPriceWan:290,bedrooms:2,elevator:true},{id:'b',totalPriceWan:340,bedrooms:2,elevator:true},{id:'c',totalPriceWan:280,bedrooms:2,elevator:false},{id:'demo',totalPriceWan:200,bedrooms:2,elevator:true,isDemo:true}];
 assert.deepEqual(candidateContext('首付暂时不想说，先给我看看',data,rows).baselineIds,['a']);
 assert.deepEqual(candidateContext('通勤太远了',data,rows).listings,[]);
 const result=candidateContext('如果多花50万，选择会不会好一点',data,rows);
 assert.deepEqual(result.baselineIds,['a']);assert.deepEqual(result.alternativeIds,['a','b']);assert.equal(data.profile.budget,300);
 assert.deepEqual(candidateContext('推荐房源',{profile:{budget:100},requirements:{}},rows).listings,[]);
});
