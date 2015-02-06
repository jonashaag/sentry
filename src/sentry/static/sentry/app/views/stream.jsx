/*** @jsx React.DOM */
var React = require("react");
var Reflux = require("reflux");
var Router = require("react-router");
var $ = require("jquery");

var api = require("../api");
var AggregateListActions = require("../actions/aggregateListActions");
var AggregateListStore = require("../stores/aggregateListStore");
var LoadingError = require("../components/loadingError");
var LoadingIndicator = require("../components/loadingIndicator");
var StreamAggregate = require('./stream/aggregate');
var StreamActions = require('./stream/actions');
var StreamFilters = require('./stream/filters');
var StreamPagination = require('./stream/pagination');
var utils = require("../utils");

// TODO(dcramer): the poller/collection needs to actually unshift/pop
// items from the AggregateListStore to ensure it doesnt grow in memory
var StreamPoller = function(options){
  this.options = options;
  this._timeoutId = null;
  this._active = true;
  this._delay = 3000;
  this._pollingEndpoint = options.endpoint;
};
StreamPoller.prototype.enable = function(){
  this._active = true;
  if (!this._timeoutId) {
    this._timeoutId = window.setTimeout(this.poll.bind(this), this._delay);
  }
};
StreamPoller.prototype.disable = function(){
  this._active = false;
  if (this._timeoutId) {
    window.clearTimeout(this._timeoutId);
    this._timeoutId = null;
  }
};
StreamPoller.prototype.poll = function() {
  api.request(this._pollingEndpoint, {
    success: (data, _, jqXHR) => {
      // cancel in progress operation if disabled
      if (!this._active) {
        return;
      }

      // if theres no data, nothing changes
      if (!data.length) {
        return;
      }

      var links = utils.parseLinkHeader(jqXHR.getResponseHeader('Link'));
      this._pollingEndpoint = links.previous.href;

      this.options.success(data);
    },
    complete: () => {
      if (this._active) {
        this._timeoutId = window.setTimeout(this.poll.bind(this), this._delay);
      }
    }
  });
};

var Stream = React.createClass({
  mixins: [
    Reflux.listenTo(AggregateListStore, "onAggListChange"),
    Router.State
  ],

  propTypes: {
    memberList: React.PropTypes.instanceOf(Array).isRequired
  },

  onAggListChange() {
    this.setState({
      aggList: AggregateListStore.getAllItems()
    });
  },

  getInitialState() {
    return {
      aggList: new utils.Collection([], {
        limit: 50
      }),
      selectAllActive: false,
      multiSelected: false,
      anySelected: false,
      statsPeriod: '24h',
      realtimeActive: false,
      pageLinks: '',
      loading: true,
      error: false
    };
  },

  componentWillMount() {
    this._poller = new StreamPoller({
      success: this.handleRealtimePoll,
      endpoint: this.getAggregateListEndpoint()
    });

    this.fetchData();
  },

  componentWillReceiveProps(nextProps) {
    this.fetchData();
  },

  componentWillUnmount() {
    this._poller.disable();
  },

  componentDidUpdate(prevProps, prevState) {
    if (prevState.realtimeActive !== this.state.realtimeActive) {
      if (this.state.realtimeActive) {
        this._poller.enable();
      } else {
        this._poller.disable();
      }
    }
  },

  fetchData() {
    this.setState({
      loading: true,
      error: false
    });

    api.request(this.getAggregateListEndpoint(), {
      success: (data, _, jqXHR) => {
        AggregateListStore.loadInitialData(data);

        this.setState({
          error: false,
          loading: false,
          pageLinks: jqXHR.getResponseHeader('Link')
        });
      },
      error: () => {
        this.setState({
          error: true,
          loading: false
        });
      },
      complete: () => {
        if (this.state.realtimeActive) {
          this._poller.enable();
        }
      }
    });
  },

  getAggregateListEndpoint() {
    var params = this.getParams();
    var queryParams = this.getQuery();
    var querystring = $.param(queryParams);

    return '/projects/' + params.orgId + '/' + params.projectId + '/groups/?' + querystring;
  },
  handleRealtimeChange(event) {
    this.setState({
      realtimeActive: !this.state.realtimeActive
    });
  },
  handleSelectStatsPeriod(period) {
    this.setState({
      statsPeriod: period
    });
  },
  handleRealtimePoll(data) {
    this.setState({
      aggList: this.state.aggList.unshift(data)
    });
  },
  render() {
    var aggNodes = this.state.aggList.map((node) => {
      return <StreamAggregate
          key={node.id}
          data={node}
          memberList={this.props.memberList}
          statsPeriod={this.state.statsPeriod} />;
    });

    var params = this.getParams();

    return (
      <div>
        <StreamFilters />
        <div className="group-header-container" data-spy="affix" data-offset-top="134">
          <div className="container">
            <div className="group-header">
              <StreamActions
                orgId={params.orgId}
                projectId={params.projectId}
                onSelectStatsPeriod={this.handleSelectStatsPeriod}
                onRealtimeChange={this.handleRealtimeChange}
                realtimeActive={this.state.realtimeActive}
                statsPeriod={this.state.statsPeriod}
                aggList={this.state.aggList} />
            </div>
          </div>
        </div>
        {this.state.loading ?
          <LoadingIndicator />
        : (this.state.error ?
          <LoadingError onRetry={this.fetchData} />
        :
          <ul className="group-list">
            {aggNodes}
          </ul>
        )}
        <StreamPagination
          aggList={this.state.aggList}
          pageLinks={this.state.pageLinks} />
      </div>
    );
  }
});

module.exports = Stream;