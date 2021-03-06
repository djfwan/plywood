module Plywood {
  export interface PostProcess {
    (result: any): Dataset;
  }

  export interface QueryAndPostProcess<T> {
    query: T;
    postProcess: PostProcess;
  }

  export interface IntrospectPostProcess {
    (result: any): Attributes;
  }

  export interface IntrospectQueryAndPostProcess<T> {
    query: T;
    postProcess: IntrospectPostProcess;
  }

  export var aggregateActions: Lookup<number> = {
    count: 1,
    sum: 1,
    min: 1,
    max: 1,
    average: 1,
    countDistinct: 1,
    quantile: 1
  };

  export function mergeExternals(externalGroups: External[][]): External[] {
    var seen: Lookup<External> = {};
    externalGroups.forEach(externalGroup => {
      externalGroup.forEach(external => {
        var id = external.getId();
        if (seen[id]) return;
        seen[id] = external;
      })
    });
    return Object.keys(seen).sort().map(k => seen[k]);
  }

  function getSampleValue(valueType: string, ex: Expression): any {
    switch (valueType) {
      case 'BOOLEAN':
        return true;

      case 'NUMBER':
        return 4;

      case 'NUMBER_RANGE':
        var numberBucketAction: NumberBucketAction;
        if (ex instanceof ChainExpression && (numberBucketAction = <NumberBucketAction>ex.getSingleAction('numberBucket'))) {
          return new NumberRange({
            start: numberBucketAction.offset,
            end: numberBucketAction.offset + numberBucketAction.size
          });
        } else {
          return new NumberRange({ start: 0, end: 1 });
        }

      case 'TIME':
        return new Date('2015-03-14T00:00:00');

      case 'TIME_RANGE':
        var timeBucketAction: TimeBucketAction;
        if (ex instanceof ChainExpression && (timeBucketAction = <TimeBucketAction>ex.getSingleAction('timeBucket'))) {
          var start = timeBucketAction.duration.floor(new Date('2015-03-14T00:00:00'), timeBucketAction.timezone);
          return new TimeRange({
            start,
            end: timeBucketAction.duration.move(start, timeBucketAction.timezone, 1)
          });
        } else {
          return new TimeRange({ start: new Date('2015-03-14T00:00:00'), end: new Date('2015-03-15T00:00:00') });
        }

      case 'STRING':
        if (ex instanceof RefExpression) {
          return 'some_' + ex.name;
        } else {
          return 'something';
        }

      default:
        throw new Error("unsupported simulation on: " + valueType);
    }
  }

  function immutableAdd<T>(obj: Lookup<T>, key: string, value: T): Lookup<T> {
    var newObj = Object.create(null);
    for (var k in obj) newObj[k] = obj[k];
    newObj[key] = value;
    return newObj;
  }

  export interface ExternalValue {
    engine?: string;
    suppress?: boolean;
    attributes?: Attributes;
    attributeOverrides?: Attributes;
    key?: string;
    mode?: string;
    dataName?: string;

    filter?: Expression;
    rawAttributes?: Attributes;
    derivedAttributes?: Lookup<Expression>;
    split?: Expression;
    applies?: ApplyAction[];
    sort?: SortAction;
    limit?: LimitAction;
    havingFilter?: Expression;

    // MySQL
    table?: string;

    // Druid
    dataSource?: string | string[];
    timeAttribute?: string;
    allowEternity?: boolean;
    allowSelectQueries?: boolean;
    exactResultsOnly?: boolean;
    context?: Lookup<any>;

    requester?: Requester.PlywoodRequester<any>;
  }

  export interface ExternalJS {
    engine: string;
    attributes?: AttributeJSs;
    attributeOverrides?: AttributeJSs;
    key?: string;

    filter?: ExpressionJS;
    rawAttributes?: AttributeJSs;

    // MySQL
    table?: string;

    // Druid
    dataSource?: string | string[];
    timeAttribute?: string;
    allowEternity?: boolean;
    allowSelectQueries?: boolean;
    exactResultsOnly?: boolean;
    context?: Lookup<any>;

    requester?: Requester.PlywoodRequester<any>;
  }

  export class External {
    static type = 'EXTERNAL';

    static isExternal(candidate: any): boolean {
      return isInstanceOf(candidate, External);
    }

    static jsToValue(parameters: ExternalJS): ExpressionValue {
      var value: ExternalValue = {
        engine: parameters.engine,
        suppress: true,
        key: parameters.key
      };
      if (parameters.attributes) {
        value.attributes = AttributeInfo.fromJSs(parameters.attributes);
      }
      if (parameters.attributeOverrides) {
        value.attributeOverrides = AttributeInfo.fromJSs(parameters.attributeOverrides);
      }
      if (parameters.requester) value.requester = parameters.requester;
      value.filter = parameters.filter ? Expression.fromJS(parameters.filter) : Expression.TRUE;

      return value;
    }

    static classMap: Lookup<typeof External> = {};
    static register(ex: typeof External, id: string = null): void {
      if (!id) id = (<any>ex).name.replace('External', '').replace(/^\w/, (s: string) => s.toLowerCase());
      External.classMap[id] = ex;
    }

    static fromJS(parameters: ExternalJS): External {
      if (!hasOwnProperty(parameters, "engine")) {
        throw new Error("external `engine` must be defined");
      }
      var engine: string = parameters.engine;
      if (typeof engine !== "string") {
        throw new Error("dataset must be a string");
      }
      var ClassFn = External.classMap[engine];
      if (!ClassFn) {
        throw new Error(`unsupported engine '${engine}'`);
      }
      return ClassFn.fromJS(parameters);
    }

    public engine: string;
    public suppress: boolean;
    public attributes: Attributes = null;
    public attributeOverrides: Attributes = null;
    public key: string = null;

    public rawAttributes: Attributes = null;
    public requester: Requester.PlywoodRequester<any>;
    public mode: string; // raw, total, split (potential aggregate mode)
    public derivedAttributes: Lookup<Expression>;
    public filter: Expression;
    public split: Expression;
    public dataName: string;
    public applies: ApplyAction[];
    public sort: SortAction;
    public limit: LimitAction;
    public havingFilter: Expression;

    constructor(parameters: ExternalValue, dummy: Dummy = null) {
      if (dummy !== dummyObject) {
        throw new TypeError("can not call `new External` directly use External.fromJS instead");
      }
      this.engine = parameters.engine;
      this.suppress = parameters.suppress === true;
      if (parameters.attributes) {
        this.attributes = parameters.attributes;
      }
      if (parameters.attributeOverrides) {
        this.attributeOverrides = parameters.attributeOverrides;
      }
      if (parameters.key) {
        this.key = parameters.key;
      }
      this.rawAttributes = parameters.rawAttributes;
      this.requester = parameters.requester;
      this.mode = parameters.mode || 'raw';
      this.derivedAttributes = parameters.derivedAttributes || {};
      this.filter = parameters.filter || Expression.TRUE;
      this.split = parameters.split;
      this.dataName = parameters.dataName;
      this.applies = parameters.applies;
      this.sort = parameters.sort;
      this.limit = parameters.limit;
      this.havingFilter = parameters.havingFilter;

      if (this.mode !== 'raw') {
        this.applies = this.applies || [];

        if (this.mode === 'split') {
          if (!this.split) throw new Error('must have split in split mode');
          if (!this.key) throw new Error('must have key in split mode');
          this.havingFilter = this.havingFilter || Expression.TRUE;
        }
      }
    }

    protected _ensureEngine(engine: string) {
      if (!this.engine) {
        this.engine = engine;
        return;
      }
      if (this.engine !== engine) {
        throw new TypeError(`incorrect engine '${this.engine}' (needs to be: '${engine}')`);
      }
    }

    public valueOf(): ExternalValue {
      var value: ExternalValue = {
        engine: this.engine
      };
      if (this.suppress) value.suppress = this.suppress;
      if (this.attributes) value.attributes = this.attributes;
      if (this.attributeOverrides) value.attributeOverrides = this.attributeOverrides;
      if (this.key) value.key = this.key;

      if (this.rawAttributes) {
        value.rawAttributes = this.rawAttributes;
      }
      if (this.requester) {
        value.requester = this.requester;
      }
      value.mode = this.mode;
      if (this.dataName) {
        value.dataName = this.dataName;
      }
      value.derivedAttributes = this.derivedAttributes;
      value.filter = this.filter;
      if (this.split) {
        value.split = this.split;
      }
      if (this.applies) {
        value.applies = this.applies;
      }
      if (this.sort) {
        value.sort = this.sort;
      }
      if (this.limit) {
        value.limit = this.limit;
      }
      if (this.havingFilter) {
        value.havingFilter = this.havingFilter;
      }
      return value;
    }

    public toJS(): ExternalJS {
      var js: ExternalJS = {
        engine: this.engine
      };
      if (this.attributes) js.attributes = AttributeInfo.toJSs(this.attributes);
      if (this.attributeOverrides) js.attributeOverrides = AttributeInfo.toJSs(this.attributeOverrides);
      if (this.key) js.key = this.key;

      if (this.rawAttributes) js.rawAttributes = AttributeInfo.toJSs(this.rawAttributes);
      if (this.requester) {
        js.requester = this.requester;
      }
      if (!this.filter.equals(Expression.TRUE)) {
        js.filter = this.filter.toJS();
      }
      return js;
    }

    public toJSON(): ExternalJS {
      return this.toJS();
    }

    public toString(): string {
      switch (this.mode) {
        case 'raw':
          return `ExternalRaw(${this.filter.toString()})`;

        case 'total':
          return `ExternalTotal(${this.applies.length})`;

        case 'split':
          return `ExternalSplit(${this.applies.length})`;

        default :
          return 'External()';
      }

    }

    public equals(other: External): boolean {
      return External.isExternal(other) &&
        this.engine === other.engine &&
        this.mode === other.mode &&
        this.filter.equals(other.filter);
    }

    public getId(): string {
      return this.engine + ':' + this.filter.toString();
    }

    public hasExternal(): boolean {
      return true;
    }

    public getExternals(): External[] {
      return [this];
    }

    public getExternalIds(): string[] {
      return [this.getId()]
    }

    public getAttributesInfo(attributeName: string) {
      return this.rawAttributes ? this.rawAttributes[attributeName] : this.attributes[attributeName];
    }

    // -----------------

    public canHandleFilter(ex: Expression): boolean {
      throw new Error("must implement canHandleFilter");
    }

    public canHandleTotal(): boolean {
      throw new Error("must implement canHandleTotal");
    }

    public canHandleSplit(ex: Expression): boolean {
      throw new Error("must implement canHandleSplit");
    }

    public canHandleApply(ex: Expression): boolean {
      throw new Error("must implement canHandleApply");
    }

    public canHandleSort(sortAction: SortAction): boolean {
      throw new Error("must implement canHandleSort");
    }

    public canHandleLimit(limitAction: LimitAction): boolean {
      throw new Error("must implement canHandleLimit");
    }

    public canHandleHavingFilter(ex: Expression): boolean {
      throw new Error("must implement canHandleHavingFilter");
    }

    // -----------------

    // ToDo: make this better
    public getRaw(): External {
      if (this.mode === 'raw') return this;

      var value = this.valueOf();
      value.suppress = true;
      value.mode = 'raw';
      value.dataName = null;
      value.attributes = value.rawAttributes;
      value.rawAttributes = null;
      value.applies = [];
      value.split = null;
      value.sort = null;
      value.limit = null;

      return <External>(new (External.classMap[this.engine])(value));
    }

    public makeTotal(dataName: string): External {
      if (this.mode !== 'raw') return null; // Can only split on 'raw' datasets
      if (!this.canHandleTotal()) return null;

      var value = this.valueOf();
      value.suppress = false;
      value.mode = 'total';
      value.dataName = dataName;
      value.rawAttributes = value.attributes;
      value.attributes = {};

      return <External>(new (External.classMap[this.engine])(value));
    }

    public addAction(action: Action): External {
      if (action instanceof FilterAction) {
        return this._addFilterAction(action);
      }
      if (action instanceof SplitAction) {
        return this._addSplitAction(action);
      }
      if (action instanceof ApplyAction) {
        return this._addApplyAction(action);
      }
      if (action instanceof SortAction) {
        return this._addSortAction(action);
      }
      if (action instanceof LimitAction) {
        return this._addLimitAction(action);
      }
      return null;
    }

    private _addFilterAction(action: FilterAction): External {
      return this.addFilter(action.expression);
    }

    public addFilter(expression: Expression): External {
      if (!expression.resolved()) return null;

      var value = this.valueOf();
      switch (this.mode) {
        case 'raw':
          if (!this.canHandleFilter(expression)) return null;
          value.filter = value.filter.and(expression).simplify();
          break;

        case 'split':
          if (!this.canHandleHavingFilter(expression)) return null;
          value.havingFilter = value.havingFilter.and(expression).simplify();
          break;

        default:
          return null; // can not add filter in total mode
      }

      return <External>(new (External.classMap[this.engine])(value));
    }

    private _addSplitAction(action: SplitAction): External {
      var expression = action.expression;
      var name = action.name;
      if (this.mode !== 'raw') return null; // Can only split on 'raw' datasets
      if (!this.canHandleSplit(expression)) return null;

      var value = this.valueOf();
      value.suppress = false;
      value.mode = 'split';
      value.dataName = action.dataName;
      value.split = expression;
      value.key = name;
      value.rawAttributes = value.attributes;
      value.attributes = Object.create(null);
      value.attributes[name] = new AttributeInfo({ type: expression.type });

      return <External>(new (External.classMap[this.engine])(value));
    }

    private _addApplyAction(action: ApplyAction): External {
      var expression = action.expression;
      if (expression.type !== 'NUMBER' && expression.type !== 'TIME') return null;
      if (!this.canHandleApply(action.expression)) return null;

      var value = this.valueOf();
      if (this.mode === 'raw') {
        value.derivedAttributes = immutableAdd(
          value.derivedAttributes, action.name, action.expression
        );
        value.attributes = immutableAdd(
          value.attributes, action.name, new AttributeInfo({ type: action.expression.type })
        );
      } else {
        // Can not redefine index for now.
        if (action.name === this.key) return null;

        var basicActions = this.processApply(action);
        for (let basicAction of basicActions) {
          if (basicAction instanceof ApplyAction) {
            value.applies = value.applies.concat(basicAction);
            value.attributes = immutableAdd(
              value.attributes, basicAction.name, new AttributeInfo({ type: basicAction.expression.type })
            );
          } else {
            throw new Error('got something strange from breakUpApply');
          }
        }
      }
      return <External>(new (External.classMap[this.engine])(value));
    }

    private _addSortAction(action: SortAction): External {
      if (this.limit) return null; // Can not sort after limit
      if (!this.canHandleSort(action)) return null;

      var value = this.valueOf();
      value.sort = action;
      return <External>(new (External.classMap[this.engine])(value));
    }

    private _addLimitAction(action: LimitAction): External {
      if (!this.canHandleLimit(action)) return null;

      var value = this.valueOf();
      if (!value.limit || action.limit < value.limit.limit) {
        value.limit = action;
      }
      return <External>(new (External.classMap[this.engine])(value));
    }

    // ----------------------

    public getExistingApplyForExpression(expression: Expression): ApplyAction {
      var applies = this.applies;
      for (let apply of applies) {
        if (apply.expression.equals(expression)) return apply;
      }
      return null;
    }

    public isKnownName(name: string): boolean {
      return hasOwnProperty(this.attributes, name);
    }

    public getTempName(namesTaken: string[] = []): string {
      for (let i = 0; i < 1e6; i++) {
        var name = '_sd_' + i;
        if (namesTaken.indexOf(name) === -1 && !this.isKnownName(name)) return name;
      }
      throw new Error('could not find available name');
    }

    public sortOnLabel(): boolean {
      var sort = this.sort;
      if (!sort) return false;

      var sortOn = (<RefExpression>sort.expression).name;
      if (sortOn !== this.key) return false;

      var applies = this.applies;
      for (let apply of applies) {
        if (apply.name === sortOn) return false;
      }

      return true;
    }

    public separateAggregates(apply: ApplyAction): ApplyAction[] {
      var applyExpression = apply.expression;
      if (applyExpression instanceof ChainExpression) {
        var actions = applyExpression.actions;
        if (aggregateActions[actions[actions.length - 1].action]) {
          // This is a vanilla aggregate, just return it.
          return [apply];
        }
      }

      var applies: ApplyAction[] = [];
      var namesUsed: string[] = [];

      var newExpression = applyExpression.substituteAction(
        (action) => {
          return Boolean(aggregateActions[action.action]);
        },
        (preEx: Expression, action: Action) => {
          var aggregateChain = preEx.performAction(action);
          var existingApply = this.getExistingApplyForExpression(aggregateChain);
          if (existingApply) {
            return new RefExpression({
              name: existingApply.name,
              nest: 0,
              type: existingApply.expression.type
            });
          } else {
            var name = this.getTempName(namesUsed);
            namesUsed.push(name);
            applies.push(new ApplyAction({
              action: 'apply',
              name: name,
              expression: aggregateChain
            }));
            return new RefExpression({
              name: name,
              nest: 0,
              type: aggregateChain.type
            });
          }
        },
        this
      );

      applies.push(new ApplyAction({
        action: 'apply',
        name: apply.name,
        expression: newExpression
      }));

      return applies;
    }

    public inlineDerivedAttributes(expression: Expression): Expression {
      var derivedAttributes = this.derivedAttributes;
      return expression.substitute(ex => {
        return null;
        /*
        if (ex instanceof AggregateExpression) {
          return ex.substitute(refEx => {
            if (refEx instanceof RefExpression) {
              var refName = refEx.name;
              return hasOwnProperty(derivedAttributes, refName) ? derivedAttributes[refName] : null;
            } else {
              return null;
            }
          });
        } else {
          return null;
        }
        */
      })
    }

    public processApply(action: ApplyAction): Action[] {
      return [action];
    }

    // -----------------

    public addNextExternal(dataset: Dataset): Dataset {
      var dataName = this.dataName;
      switch (this.mode) {
        case 'total':
          return dataset.apply(dataName, () => {
            return this.getRaw();
          }, null);

        case 'split':
          var split = this.split;
          var key = this.key;
          return dataset.apply(dataName, (d: Datum) => {
            return this.getRaw().addFilter(split.is(new LiteralExpression({ value: d[key] })).simplify());
          }, null);

        default:
          return dataset;
      }
    }

    public simulate(): Dataset {
      var datum: Datum = {};

      if (this.mode === 'raw') {
        var attributes = this.attributes;
        for (let attributeName in attributes) {
          if (!hasOwnProperty(attributes, attributeName)) continue;
          datum[attributeName] = getSampleValue(attributes[attributeName].type, null);
        }
      } else {
        if (this.mode === 'split') {
          datum[this.key] = getSampleValue(this.split.type, this.split);
        }

        var applies = this.applies;
        for (let apply of applies) {
          datum[apply.name] = getSampleValue(apply.expression.type, apply.expression);
        }
      }

      var dataset = new Dataset({ data: [datum] });
      dataset = this.addNextExternal(dataset);
      return dataset;
    }

    public getQueryAndPostProcess(): QueryAndPostProcess<any> {
      throw new Error("can not call getQueryAndPostProcess directly");
    }

    public queryValues(): Q.Promise<Dataset> {
      if (!this.requester) {
        return <Q.Promise<Dataset>>Q.reject(new Error('must have a requester to make queries'));
      }
      try {
        var queryAndPostProcess = this.getQueryAndPostProcess();
      } catch (e) {
        return <Q.Promise<Dataset>>Q.reject(e);
      }
      if (!hasOwnProperty(queryAndPostProcess, 'query') || typeof queryAndPostProcess.postProcess !== 'function') {
        return <Q.Promise<Dataset>>Q.reject(new Error('no error query or postProcess'));
      }
      var result = this.requester({ query: queryAndPostProcess.query })
        .then(queryAndPostProcess.postProcess);

      if (this.mode !== 'raw') {
        result = <Q.Promise<Dataset>>result.then(this.addNextExternal.bind(this));
      }

      return result;
    }

    // -------------------------

    public needsIntrospect(): boolean {
      return !this.attributes;
    }

    public getIntrospectQueryAndPostProcess(): IntrospectQueryAndPostProcess<any> {
      throw new Error("can not call getIntrospectQueryAndPostProcess directly");
    }

    public introspect(): Q.Promise<External> {
      if (this.attributes) {
        return Q(this);
      }

      if (!this.requester) {
        return <Q.Promise<External>>Q.reject(new Error('must have a requester to introspect'));
      }
      try {
        var queryAndPostProcess = this.getIntrospectQueryAndPostProcess();
      } catch (e) {
        return <Q.Promise<External>>Q.reject(e);
      }
      if (!hasOwnProperty(queryAndPostProcess, 'query') || typeof queryAndPostProcess.postProcess !== 'function') {
        return <Q.Promise<External>>Q.reject(new Error('no error query or postProcess'));
      }
      var value = this.valueOf();
      var ClassFn = External.classMap[this.engine];
      return this.requester({ query: queryAndPostProcess.query })
        .then(queryAndPostProcess.postProcess)
        .then((attributes: Attributes) => {
          var attributeOverrides = value.attributeOverrides;
          if (attributeOverrides) {
            for (var k in attributeOverrides) {
              attributes[k] = attributeOverrides[k];
            }
          }

          value.attributes = attributes; // Once attributes are set attributeOverrides will be ignored
          return <External>(new ClassFn(value));
        })
    }

    public getFullType(): FullType {
      var attributes = this.attributes;
      if (!attributes) throw new Error("dataset has not been introspected");

      var remote = [this.engine];

      var myDatasetType: Lookup<FullType> = {};
      for (var attrName in attributes) {
        if (!hasOwnProperty(attributes, attrName)) continue;
        var attrType = attributes[attrName];
        myDatasetType[attrName] = {
          type: attrType.type,
          remote
        };
      }
      var myFullType: FullType = {
        type: 'DATASET',
        datasetType: myDatasetType,
        remote
      };
      return myFullType;
    }

    // ------------------------

    /*
    private _joinDigestHelper(joinExpression: JoinExpression, action: Action): JoinExpression {
      var ids = action.expression.getExternalIds();
      if (ids.length !== 1) throw new Error('must be single dataset');
      if (ids[0] === (<External>(<LiteralExpression>joinExpression.lhs).value).getId()) {
        var lhsDigest = this.digest(joinExpression.lhs, action);
        if (!lhsDigest) return null;
        return new JoinExpression({
          op: 'join',
          lhs: lhsDigest.expression,
          rhs: joinExpression.rhs
        });
      } else {
        var rhsDigest = this.digest(joinExpression.rhs, action);
        if (!rhsDigest) return null;
        return new JoinExpression({
          op: 'join',
          lhs: joinExpression.lhs,
          rhs: rhsDigest.expression
        });
      }
    }
    */

    public digest(expression: Expression, action: Action): Digest {
      if (expression instanceof LiteralExpression) {
        var external = expression.value;
        if (external instanceof External) {
          var newExternal = external.addAction(action);
          if (!newExternal) return null;
          return {
            undigested: null,
            expression: new LiteralExpression({
              op: 'literal',
              value: newExternal
            })
          };
        } else {
          return null;
        }

      /*
      } else if (expression instanceof JoinExpression) {
        var lhs = expression.lhs;
        var rhs = expression.rhs;
        if (lhs instanceof LiteralExpression && rhs instanceof LiteralExpression) {
          var lhsValue = lhs.value;
          var rhsValue = rhs.value;
          if (lhsValue instanceof External && rhsValue instanceof External) {
            var actionExpression = action.expression;

            if (action instanceof DefAction) {
              var actionDatasets = actionExpression.getExternalIds();
              if (actionDatasets.length !== 1) return null;
              newJoin = this._joinDigestHelper(expression, action);
              if (!newJoin) return null;
              return {
                expression: newJoin,
                undigested: null
              };

            } else if (action instanceof ApplyAction) {
              var actionDatasets = actionExpression.getExternalIds();
              if (!actionDatasets.length) return null;
              var newJoin: JoinExpression = null;
              if (actionDatasets.length === 1) {
                newJoin = this._joinDigestHelper(expression, action);
                if (!newJoin) return null;
                return {
                  expression: newJoin,
                  undigested: null
                };
              } else {
                var breakdown = actionExpression.breakdownByDataset('_br_');
                var singleDatasetActions = breakdown.singleDatasetActions;
                newJoin = expression;
                for (let i = 0; i < singleDatasetActions.length && newJoin; i++) {
                  newJoin = this._joinDigestHelper(newJoin, singleDatasetActions[i]);
                }
                if (!newJoin) return null;
                return {
                  expression: newJoin,
                  undigested: new ApplyAction({
                    action: 'apply',
                    name: (<ApplyAction>action).name,
                    expression: breakdown.combineExpression
                  })
                };
              }

            } else {
              return null;
            }
          } else {
            return null;
          }
        } else {
          return null;
        }
        */

      } else {
        throw new Error(`can not digest ${expression.op}`);
      }
    }

  }
}
