/*
 * Postmonger local minimal bridge for Salesforce Marketing Cloud Journey Builder.
 *
 * Important:
 * - Sends ONE official Postmonger message.
 * - Sends ONLY to window.parent.
 * - Does NOT send duplicate object/string messages.
 * - Does NOT post to window.top.
 *
 * Duplicate messages or posting to top can make some Journey Builder shells show
 * the loading overlay again after it initially disappears.
 */
(function (window) {
  'use strict';

  function safeParse(data) {
    if (typeof data !== 'string') return data;
    try {
      return JSON.parse(data);
    } catch (_err) {
      return null;
    }
  }

  function Session() {
    this.handlers = {};
    this.target = window.parent && window.parent !== window ? window.parent : null;
    this.targetOrigin = '*';

    var self = this;

    window.addEventListener('message', function (event) {
      var data = safeParse(event.data);
      if (!data || typeof data !== 'object') return;

      var eventName = null;
      var args = [];

      if (data.method === 'trigger' && Array.isArray(data.args) && data.args.length) {
        args = data.args;
        eventName = args[0];
      } else if (data.event || data.key || data.name || data.type) {
        eventName = data.event || data.key || data.name || data.type;
        args = [eventName, data.data || data.payload || data.value];
      }

      if (!eventName) return;

      var handlers = self.handlers[eventName] || [];
      handlers.forEach(function (handler) {
        try {
          handler.apply(null, args.slice(1));
        } catch (err) {
          window.setTimeout(function () {
            throw err;
          }, 0);
        }
      });
    }, false);
  }

  Session.prototype.on = function (eventName, handler) {
    this.handlers[eventName] = this.handlers[eventName] || [];
    this.handlers[eventName].push(handler);
    return this;
  };

  Session.prototype.off = function (eventName, handler) {
    if (!this.handlers[eventName]) return this;
    if (!handler) {
      delete this.handlers[eventName];
      return this;
    }
    this.handlers[eventName] = this.handlers[eventName].filter(function (item) {
      return item !== handler;
    });
    return this;
  };

  Session.prototype.trigger = function () {
    if (!this.target || !this.target.postMessage) return this;

    var args = Array.prototype.slice.call(arguments);
    var message = {
      method: 'trigger',
      args: args
    };

    this.target.postMessage(JSON.stringify(message), this.targetOrigin);
    return this;
  };

  window.Postmonger = {
    Session: Session
  };
})(window);
