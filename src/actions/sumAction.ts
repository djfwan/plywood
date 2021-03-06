module Plywood {
  export class SumAction extends Action {
    static fromJS(parameters: ActionJS): SumAction {
      return new SumAction(Action.jsToValue(parameters));
    }

    constructor(parameters: ActionValue) {
      super(parameters, dummyObject);
      this._ensureAction("sum");
    }

    public getOutputType(inputType: string): string {
      this._checkInputType(inputType, 'DATASET');
      return 'NUMBER';
    }

    public _fillRefSubstitutions(typeContext: FullType, indexer: Indexer, alterations: Alterations): FullType {
      this.expression._fillRefSubstitutions(typeContext, indexer, alterations);
      return {
        type: 'NUMBER',
        remote: typeContext.remote
      };
    }

    protected _getSQLHelper(dialect: SQLDialect, inputSQL: string, expressionSQL: string): string {
      return 'SUM(' + expressionSQL + ')';
    }

    public isNester(): boolean {
      return true;
    }

    public canDistribute(): boolean {
      var expression = this.expression;
      return expression instanceof LiteralExpression ||
        Boolean(expression.getExpressionPattern('add') || expression.getExpressionPattern('subtract'));
    }

    public distribute(preEx: Expression): Expression {
      var expression = this.expression;
      if (expression instanceof LiteralExpression) {
        var value = expression.value;
        if (value === 0) return Expression.ZERO;
        return expression.multiply(preEx.count());
      }

      var pattern: Expression[];
      if (pattern = expression.getExpressionPattern('add')) {
        return Expression.add(pattern.map(ex => preEx.sum(ex).distribute()));
      }
      if (pattern = expression.getExpressionPattern('subtract')) {
        return Expression.subtract(pattern.map(ex => preEx.sum(ex).distribute()));
      }
      return null;
    }
  }

  Action.register(SumAction);
}
