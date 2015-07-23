{ expect } = require("chai")

{ testHigherObjects } = require("higher-object/build/tester")

plywood = require('../../build/plywood')
{ Action, $ } = plywood

describe "Actions", ->
  it "passes higher object tests", ->
    testHigherObjects(Action, [
      {
        action: 'apply'
        name: 'Five'
        expression: { op: 'literal', value: 5 }
      }
      {
        action: 'filter'
        expression: {
          op: 'chain'
          expression: { op: 'ref', name: 'myVar' }
          actions: [
            { action: 'is', expression: { op: 'literal', value: 5 } }
          ]
        }
      }
      {
        action: 'sort'
        expression: { op: 'ref', name: 'myVar' }
        direction: 'ascending'
      }
      {
        action: 'limit'
        limit: 10
      }
    ], {
      newThrows: true
    })

  it "does not die with hasOwnProperty", ->
    expect(Action.fromJS({
      action: 'apply'
      name: 'Five'
      expression: { op: 'literal', value: 5 }
      hasOwnProperty: 'troll'
    }).toJS()).deep.equal({
      action: 'apply'
      name: 'Five'
      expression: { op: 'literal', value: 5 }
    })