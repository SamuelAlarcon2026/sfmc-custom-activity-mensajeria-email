/*
 * Postmonger compatible local bridge for SFMC Journey Builder.
 * Bundled locally to avoid CDN/npm path issues inside the Journey Builder iframe.
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

  function uniqueTargets() {
    var targets = [];
    function push(target) {
      if (!target || target === window) return;
      if (targets.indexOf(target) === -1) targets.push(target);
    }

    try { push(window.parent); } catch (_err) {}
    try { push(window.top); } catch (_err) {}
    try { push(window.opener); } catch (_err) {}

    return targets;
  }

  function Session() {
    this.handlers = {};
    var self = this;

    window.addEventListener('message', function (event) {
      var data = safeParse(event.data);
      if (!data || typeof data !== 'object') return;

      var args = [];
      var eventName = null;

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
          window.setTimeout(function () { throw err; }, 0);
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
    var args = Array.prototype.slice.call(arguments);
    var message = {
      method: 'trigger',
      args: args
    };

    uniqueTargets().forEach(function (target) {
      try {
        target.postMessage(JSON.stringify(message), '*');
      } catch (_err) {}

      /*
       * Some SFMC shells accept the object form too. Sending both is harmless
       * because Journey Builder ignores unknown/duplicate messages.
       */
      try {
        target.postMessage(message, '*');
      } catch (_err) {}
    });

    return this;
  };

  window.Postmonger = {
    Session: Session
  };
})(window);
