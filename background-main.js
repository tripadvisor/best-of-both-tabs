'use strict';

(function () {
    /**
     * Represents an association between individual tabs in the mobile window and individual tabs in the desktop window
     */
    class MobileDesktopPairings {
        constructor() {
            this._keyedByDesktop = {};
            this._keyedByMobile = {};
        };

        /**
         * Add a tab pairing
         * @param desktopTabId Integer Tab ID of the desktop tab to be added to the pairing
         * @param mobileTabId Integer Tab ID of the mobile tab to be added to the pairing
         */
        addPair (desktopTabId, mobileTabId) {
            if (!Number.isInteger(desktopTabId) || !Number.isInteger(mobileTabId)) {
                throw new Error('Tried to insert non-integer into MobileDesktopPairings');
            }
            this._keyedByDesktop[desktopTabId] = mobileTabId;
            this._keyedByMobile[mobileTabId] = desktopTabId;
        };

        getCorrespondingTab(tabId) {
            if (!Number.isInteger(tabId)) {
                throw new Error('Given Tab Id is not an integer');
            }
            return this._keyedByDesktop[tabId] || this._keyedByMobile[tabId] || false;
        };

        contains(tabId) {
            if (!Number.isInteger(tabId)) {
                throw new Error('Given Tab Id is not an integer');
            }
            return !!this.getCorrespondingTab(tabId);
        };

        /**
         * Removes a pair from the mapping
         * @param eitherTabId Integer id of either the desktop or mobile tab from the map
         */
        removeTabPair(eitherTabId) {
            if (!Number.isInteger(eitherTabId)) {
                throw new Error('Given Tab Id is not an integer');
            }
            delete this._keyedByDesktop[eitherTabId];
            delete this._keyedByMobile[eitherTabId];
        };

        /**
         * Clear all tab pairings from this object
         */
        clearPairings() {
            this._keyedByDesktop = {};
            this._keyedByMobile = {};
        };

        /**
         * Is the tab a desktop tab? Will also return false if tab does not exist in any pairing
         * @param tabId Integer
         */
        isDesktopTab(tabId) {
            return !!this._keyedByDesktop[tabId];
        };
    }

    // The set of mobile-desktop tab pairings
    const tabPairs = new MobileDesktopPairings();

    // ID's of desktop (left) and mobile (right) windows
    let desktopWindowId;
    let mobileWindowId;

    // Marks whether a new tab is currently being created, prevents "infinite loops" of tab creation
    let newTabBeingCreated = false;

    // Keep track of current active window so we can know if tab navigation was user initiated or programmatic
    let focusedWindowId;

    // Listeners for tab creation, removal, navigation, and focus change to mirror those events in the other window
    chrome.tabs.onCreated.addListener((newUserTab) => {
        const newTabUrl = newUserTab.url;
        if (!newTabBeingCreated && newUserTab.windowId === desktopWindowId) {
            // Prevents infinite loop of tab creation
            newTabBeingCreated = true;
            chrome.tabs.create({windowId: mobileWindowId}, (newProgrammaticTab) => {
                chrome.tabs.update(newProgrammaticTab.id, {url: newTabUrl}, (updatedProgrammaticTab) => {
                    // New tab is in desktop window, programmatic is mobile
                    tabPairs.addPair(newUserTab.id, newProgrammaticTab.id);
                    newTabBeingCreated = false;
                });
            });
        } else if (!newTabBeingCreated && newUserTab.windowId === mobileWindowId) {
            newTabBeingCreated = true;
            chrome.tabs.create({windowId: desktopWindowId}, (newProgrammaticTab) => {
                // New tab is in mobile window, programmatic is desktop
                chrome.tabs.update(newProgrammaticTab.id, {url: newTabUrl}, (updatedProgrammaticTab) => {
                    tabPairs.addPair(newProgrammaticTab.id, newUserTab.id);
                    newTabBeingCreated = false;
                });
            });
        }
    });

    chrome.tabs.onRemoved.addListener((removedTabId) => {
        const correspondingTab = tabPairs.getCorrespondingTab(removedTabId);
        if (correspondingTab) {
            tabPairs.removeTabPair(removedTabId);
            chrome.tabs.remove(correspondingTab);
        }
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
        const correspondingTab = tabPairs.getCorrespondingTab(activeInfo.tabId);
        if (correspondingTab && (activeInfo.windowId === desktopWindowId || activeInfo.windowId === mobileWindowId)) {
            chrome.tabs.update(correspondingTab, {selected: true});
        }
    });

    chrome.windows.onFocusChanged.addListener((newFocusedWindowId) => {
        focusedWindowId = newFocusedWindowId;
    });
    // Listens for tab navigation
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const correspondingTab = tabPairs.getCorrespondingTab(tabId);
        if (changeInfo.url && correspondingTab && tab.windowId === focusedWindowId) {
            chrome.tabs.update(correspondingTab, {url: changeInfo.url});
        }
    });

    /**
     * Clears all tracking information regarding desktop and mobile windows. This allows us to "clean up" after we're
     * done so the extension can be reactivated without any issues.
     */
    chrome.windows.onRemoved.addListener((windowId) => {
        if (windowId === mobileWindowId) {
            tabPairs.clearPairings();
            desktopWindowId = void(0);
            mobileWindowId = void(0);
            newTabBeingCreated = false;
            focusedWindowId = void(0);
        }
    });

    /**
     * Creates a mobile window mirroring the given desktop window
     * @param desktopWindow
     */
    const mirrorDesktopWindow = (desktopWindow) => {
        const desktopWindowInfo = {
            top: 0,
            left: 0,
            width: screen.width * 2 / 3,
            height: screen.height
        };

        const device = chrome.extension.getBackgroundPage().getDevice();
        const mobileWindowInfo = {
            top: 0,
            left: screen.width * 2 / 3,
            width: device.width !== 0 ? device.width : screen.width / 2,
            height: device.height !== 0 ? device.height : screen.height,
            focused: false
        };

        // resize desktop window
        chrome.windows.update(desktopWindow.id, desktopWindowInfo);

        // Mark the initializer window as the focused window
        focusedWindowId = desktopWindow.id;

        // Create mobile window, configure tab pairings window tracking
        chrome.tabs.query({active: true, windowId: desktopWindow.id}, (tabArray) => {
            const desktopActiveTab = tabArray[0];
            mobileWindowInfo.url = desktopActiveTab.url;
            chrome.windows.create(mobileWindowInfo, (mobileWindow) => {
                tabPairs.addPair(desktopActiveTab.id, mobileWindow.tabs[0].id);
                desktopWindowId = desktopWindow.id;
                mobileWindowId = mobileWindow.id;
            });
        });
    };

    const createMirroredWindow = () => {
        chrome.windows.getCurrent((window) => {
            const startSession = chrome.extension.getBackgroundPage().getStartSession();
            chrome.tabs.query({active: true, windowId: window.id}, (tabArray) => {
                if (startSession === "new") {
                    chrome.windows.create({url: tabArray[0].url}, (newWindow) => {
                        mirrorDesktopWindow(newWindow);
                    });
                } else {
                    mirrorDesktopWindow(window);
                }
            })

        });

        // Listener to handle messages from content script. For now, used for mirroring window scrolling
        // super important method!
        chrome.runtime.onMessage.addListener((message, sender) => {
            const correspondingTabId = tabPairs.getCorrespondingTab(sender.tab.id);

            // stub out scrolling messages when scrolling is locked
            const scrollLock = chrome.extension.getBackgroundPage().getScrollLock();
            if (!(message.scrollPercentage && scrollLock !== 'on') && correspondingTabId) {
                chrome.tabs.sendMessage(correspondingTabId, message);
            } else {
                console.log("Error relaying message: No corresponding tab to receive messsage");
            }
        });

        // Listener to redirect to mobile pages
        chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
            const headers = details.requestHeaders;
            // check if the tabId is a mobile page
            const isMobilePage = tabPairs.contains(details.tabId) && !tabPairs.isDesktopTab(details.tabId);
            if (isMobilePage) {
                for (let i = 0; i < headers.length; i += 1) {
                    if (headers[i].name === 'User-Agent') {
                        const device = chrome.extension.getBackgroundPage().getDevice();
                        headers[i].value = device.ua;
                        break;
                    }
                }
            }
            return {requestHeaders: headers};

        }, {urls: ["<all_urls>"]}, ['requestHeaders', 'blocking']);
    };

    chrome.browserAction.onClicked.addListener(createMirroredWindow);
})();
