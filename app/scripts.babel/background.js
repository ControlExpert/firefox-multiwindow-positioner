'use strict';

chrome.runtime.onInstalled.addListener(details => {
  console.log('previousVersion', details.previousVersion);
});

function showOptionsPage() {
  chrome.runtime.openOptionsPage();
}

//chrome.browserAction.setBadgeText({text: '\'Allo'});
//chrome.browserAction.onClicked.addListener(showOptionsPage);

//console.log('\'Allo \'Allo! Event Page for Browser Action');

var OPTIONS_KEY = 'TAB_HELPER_OPTIONS';

var POSITIONS = {
  CENTER: {id: 'center', name: 'center'},
  LEFT_HALF: {id: 'left-half', name: 'left-half'},
  RIGHT_HALF: {id: 'right-half', name: 'right-half'},
  TOP_HALF: {id: 'top-half', name: 'top-half'},
  BOTTOM_HALF: {id: 'bottom-half', name: 'bottom-half'}
};

var WINDOW_ID_NONE = -1;
var PIXEL_MONITOR_DETECTION_DELTA = 100;
var WINDOW_CHANGE_DETECTION_INTERVAL = 1000;
var MAX_MOVE_TRIES = 10;

var WINDOW_CACHE_SIZE = 20;
var windowCache = [];

var WINDOW_STATES = {
  NORMAL: 'normal',
  MINIMIZED: 'minimized',
  MAXIMIZED: 'maximized',
  FULLSCREEN: 'fullscreen',
  DOCKED: 'docked'
};

var states = {
  lastWindowInFocus: WINDOW_ID_NONE,
  currentWindowInFocus: WINDOW_ID_NONE,
  currentWindowLocationHandler: null
};

var displayInfos = [];
loadDisplayInfos();

function loadDisplayInfos() {
  chrome.system.display.getInfo(function (displayInfosResult) {
    displayInfos = displayInfosResult;
  });
}


// chrome.windows.onRemoved.addListener(function callback(windowId) {
//   console.log('Window removed ' + windowId);
//   var indexToRemove = findCachedWindow(windowId);
//   if (indexToRemove !== -1) {
//     var window = windowCache[indexToRemove];
//     windowCache.splice(indexToRemove, 1);
//     updateTabRules(windowId, window);
//   }
// });

function findCachedWindow(windowId) {
  var found = -1;
  for (var idx = 0; idx < windowCache.length; idx++) {
    if (windowCache[idx].id === windowId) {
      found = idx;
    }
  }
  return found
}

function storeWindowIntoCache(window) {
  var idx = findCachedWindow(window.id);
  if (idx >= 0) {
    windowCache.splice(idx, 1);
  }
  if (windowCache.length >= WINDOW_CACHE_SIZE) {
    windowCache.shift();
  }
  console.log('Window cached ' + window.id);
  windowCache.push(window);

}

chrome.windows.onFocusChanged.addListener(function callback(windowId) {
  console.log('Window Focused ' + windowId);
  var allIdentifiersMap = {};
  allIdentifiersMap['i' + states.lastWindowInFocus] = states.lastWindowInFocus;
  allIdentifiersMap['i' + states.currentWindowInFocus] = states.currentWindowInFocus;
  allIdentifiersMap['i' + windowId] = windowId;

  states.lastWindowInFocus = states.currentWindowInFocus;
  states.currentWindowInFocus = windowId;
  console.log('Window transition ' + states.lastWindowInFocus + ' to ' + states.currentWindowInFocus);

  for (var key in allIdentifiersMap) {
    if (allIdentifiersMap.hasOwnProperty(key)) {
      var windowId = allIdentifiersMap[key];
      if (windowId !== WINDOW_ID_NONE) {
        startUpdateTabRules(windowId);
      }
    }
  }

  function startUpdateTabRules(targetWindowId) {
    setTimeout(function () {
      updateTabRules(targetWindowId);
      setTimeout(function () {
        updateTabRules(targetWindowId);
      }, WINDOW_CHANGE_DETECTION_INTERVAL * 5);
    }, WINDOW_CHANGE_DETECTION_INTERVAL);
  }

});

function updateTabRules(windowId, cachedWindow) {
  if (cachedWindow) {
    doUpdateTabRules(cachedWindow);
  } else {
    chrome.windows.get(windowId, {
      populate: true
    }, function (window) {
      try {
        if (window) {
          storeWindowIntoCache(window);
          doUpdateTabRules(window);
        }
      } catch (e) {
        if (e.toString().indexOf('No window with id') >= 0) {
        }
      }
    });
  }

  function doUpdateTabRules(window) {
    if (window && window.tabs) {
      var tabRuleOptions = loadOptions();
      for (var idx = 0; idx < window.tabs.length; idx++) {
        var tab = window.tabs[idx];
        var tabRule = findTabRuleMatch(tabRuleOptions, tab);
        if (tabRule && tabRule.remember && !validateTabLocation(window, tab, tabRule)) {
          var monitor = findMonitorByWindow(window);
          if (monitor) {
            var position = determinePositionByCurrentLocation(monitor, window);
            if (position) {
              var changed = updateTabRuleByLocation(tabRule, monitor, position, windowId);
              if (changed) {
                saveOptions(tabRuleOptions);
              }
            }
          }
        }
      }
    }
  }
}

function determinePositionByCurrentLocation(monitor, window) {
  var position = POSITIONS.CENTER.id;
  if (window.state === WINDOW_STATES.MAXIMIZED) {
    position = POSITIONS.CENTER.id;
  } else {
    for (var key in POSITIONS) {
      if (POSITIONS.hasOwnProperty(key)) {
        var workArea = calculateWorkAreaByPosition(monitor.workArea, POSITIONS[key].id);
        if (matchesWorkArea(window, workArea, PIXEL_MONITOR_DETECTION_DELTA)) {
          position = POSITIONS[key].id;
          break;
        }
      }
    }
  }
  return position;
}

function matchesWorkArea(window, workArea, pixelErrorMargin) {
  var delta = pixelErrorMargin ? pixelErrorMargin : 0;
  return (
    window.top >= (workArea.top - delta) &&
    window.top <= (workArea.top + delta) &&
    window.top + window.height >= (workArea.top - delta) + workArea.height &&
    window.top + window.height <= (workArea.top + delta) + workArea.height &&
    window.left >= (workArea.left - delta) &&
    window.left <= (workArea.left + delta) &&
    window.left + window.width >= (workArea.left - delta) + workArea.width &&
    window.left + window.width <= (workArea.left + delta) + workArea.width
  );
}

function findMonitorByWindow(window) {
  var monitor = null;
  var highestIdx = -1;
  var highestArea = -1;
  for (var idx = 0; idx < displayInfos.length; idx++) {
    var display = displayInfos[idx];
    var displayWorkArea = display.workArea;
    var rightMostLeft = window.left > displayWorkArea.left ? window.left : displayWorkArea.left;
    var leftMostRight = window.left + window.width < displayWorkArea.left + displayWorkArea.width ?
    window.left + window.width : displayWorkArea.left + displayWorkArea.width;
    var bottomMostTop = window.top > displayWorkArea.top ? window.top : displayWorkArea.top;
    var topMostBottom = window.top + window.height < displayWorkArea.top + displayWorkArea.height ?
    window.top + window.height : displayWorkArea.top + displayWorkArea.height;

    var area = (leftMostRight - rightMostLeft) * (topMostBottom - bottomMostTop);
    if (area > highestArea) {
      highestArea = area;
      highestIdx = idx;
    }
    /*if (window.top >= displayWorkArea.top &&
     window.top <= displayWorkArea.top + displayWorkArea.height &&
     window.left >= displayWorkArea.left &&
     window.left <= displayWorkArea.left + displayWorkArea.width) {
     monitor = display;
     break;
     }*/
  }
  if (highestIdx !== -1) {
    monitor = displayInfos[highestIdx];
  }
  return monitor;
}

function updateTabRuleByLocation(tabRule, monitor, position, windowId) {
  var changed = false;
  if (tabRule.position !== position &&
    tabRule.monitor.id !== monitor.id) {
    console.log('TabRule Reposition Saved (triggered by window.id:' + windowId + ')');
    console.log(tabRule.position + ' -> ' + position);
    console.log(tabRule.monitor.workArea);
    console.log(monitor.workArea);
    tabRule.position = position;
    tabRule.monitor = monitor;
    changed = true;
  }
  return changed;
}

function validateTabLocation(window, tab, tabRule) {
  return (window.left === tabRule.monitor.workArea.left &&
  window.top === tabRule.monitor.workArea.top &&
  window.width === tabRule.monitor.workArea.width &&
  window.height === tabRule.monitor.workArea.height)
}

function findTabRuleMatch(tabRuleOptions, tab) {
  var match = null;
  if (tab) {
    for (var idx = 0; idx < tabRuleOptions.tabs.length; idx++) {
      var tabRule = tabRuleOptions.tabs[idx];
      if (tabRule.active && tab.url && tabRule.url && tab.url.indexOf(tabRule.url) >= 0) {
        match = tabRule;
        break;
      }
    }
  }
  return match;
}

function calculateWorkAreaByPosition(monitorWorkArea, position) {
  var workarea = {
    left: monitorWorkArea.left,
    top: monitorWorkArea.top,
    width: monitorWorkArea.width,
    height: monitorWorkArea.height
  };

  if (position === POSITIONS.LEFT_HALF.id) {
    workarea.width = Math.floor(workarea.width / 2);
  }
  if (position === POSITIONS.RIGHT_HALF.id) {
    var halfWidth = Math.floor(workarea.width / 2);
    workarea.left += workarea.width - halfWidth;
    workarea.width = halfWidth;
  }
  if (position === POSITIONS.TOP_HALF.id) {
    workarea.height = Math.floor(workarea.height / 2);
  }
  if (position === POSITIONS.BOTTOM_HALF.id) {
    var halfHeight = Math.floor(workarea.height / 2);
    workarea.top += workarea.height - halfHeight;
    workarea.height = halfHeight;
  }
  return workarea;
}

function loadOptions() {
  var tabRuleOptions = localStorage[OPTIONS_KEY];
  tabRuleOptions = tabRuleOptions ? JSON.parse(tabRuleOptions) : {
    tabs: []
  };
  return tabRuleOptions;
}

function saveOptions(tabRuleOptions) {
  localStorage[OPTIONS_KEY] = JSON.stringify(tabRuleOptions);
}

chrome.tabs.onCreated.addListener(onTabCreated);
chrome.tabs.onUpdated.addListener(onTabUpdate);

// function onTabUpdate(tabId, changeInfo, tab) {
//   if (changeInfo.url && changeInfo.url !== '') {
//     console.log('Tab updated id:' + tab.id + ' url:' + changeInfo.url);
//     onTabCreated(tab, true);
//   }
// }

function onTabCreated(tab, disableCreationMessage) {
  if (!disableCreationMessage) {
    console.log('Tab Created id:' + tab.id + ' url:' + tab.url);
  }
  moveTabIntoPositionedWindow(tab, 0);

  function moveTabIntoPositionedWindow(tab, count) {
    if (count > MAX_MOVE_TRIES) {
      console.log('Tab with empty url could not be resolved after ' + MAX_MOVE_TRIES + ' tries');
    }
    if (!tab.url || tab.url === '') {
      console.log('Tab with empty url, trying in 100ms');
      setTimeout(function () {
        chrome.tabs.get(tab.id, function (tab) {
          moveTabIntoPositionedWindow(tab, count + 1);
        });
      }, 100);
    } else {
      var tabRuleOptions = loadOptions();
      var tabRule = findTabRuleMatch(tabRuleOptions, tab);
      if (tabRule) {
        console.log('Tab matched ' + tab.id + ' moving tab with url:' + tab.url);
        var createData = calculateWorkAreaByPosition(tabRule.monitor.workArea, tabRule.position);
        createData.tabId = tab.id;
        if (tabRule.popup) {
          createData.type = 'popup';
        }
        chrome.windows.create(createData, function onCreated() {
        });
      }
    }
  }
}

