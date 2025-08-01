/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import { LocalizationProvider, ReactLocalization } from '@fluent/react';
import { negotiateLanguages } from '@fluent/langneg';

import * as React from 'react';
import {
  AVAILABLE_LOCALES,
  DEFAULT_LOCALE,
  fetchMessages,
  lazilyParsedBundles,
  getLocaleDirection,
} from 'firefox-profiler/app-logic/l10n';

import { ensureExists } from 'firefox-profiler/utils/flow';
import type { Localization, PseudoStrategy } from 'firefox-profiler/types';
import { L10nContext } from 'firefox-profiler/contexts/L10nContext';
import type { L10nContextType } from 'firefox-profiler/contexts/L10nContext';

type FetchProps = {|
  +requestedLocales: null | string[],
  +pseudoStrategy: PseudoStrategy,
  +receiveL10n: (
    localization: Localization,
    primaryLocale: string,
    direction: 'ltr' | 'rtl'
  ) => void,
|};

/**
 * This class is responsible for handling the changes of the requested locales
 * and the pseudo strategy, including fetching the FTL files and generating the
 * Fluent bundles. Afterwards it will change the state with the negotiated
 * information and the bundles so that AppLocalizationProvider can supply them
 * to the rest of the app.
 */
class AppLocalizationFetcher extends React.PureComponent<FetchProps> {
  /**
   * This function is called when this component is rendered, that is at mount
   * time and when either requestedLocales or pseudoStrategy changes.
   * It takes the locales available and generates l10n bundles for those locales.
   * Finally it dispatches the translations and updates the state.
   */
  async _setupLocalization() {
    const { requestedLocales, pseudoStrategy, receiveL10n } = this.props;

    if (!requestedLocales) {
      return;
    }

    // Setting defaultLocale to `en-US` means that it will always be the
    // last fallback locale, thus making sure the UI is always working.
    const languages = negotiateLanguages(requestedLocales, AVAILABLE_LOCALES, {
      defaultLocale: DEFAULT_LOCALE,
    });

    // It's important to note that `languages` is the result of the negotiation,
    // and can be different than `locales`.
    // languages may contain the requested locale as well as some fallback
    // locales. Also `negotiateLanguages` always adds the default locale if it's
    // not present.
    // Some examples:
    // * navigator.locales == ['fr', 'en-US', 'en'] => languages == ['fr-FR', 'en-US', 'en-GB']
    // * navigator.locales == ['fr'] => languages == ['fr-FR', 'en-US']
    // Because our primary locale is en-US it's not useful to go past it and
    // fetch more locales than necessary, so let's slice to that entry.
    const indexOfDefaultLocale = languages.indexOf(DEFAULT_LOCALE); // Guaranteed to be positive
    const localesToFetch = languages.slice(0, indexOfDefaultLocale + 1);
    const fetchedMessages = await Promise.all(
      localesToFetch.map(fetchMessages)
    );
    const bundles = lazilyParsedBundles(fetchedMessages, pseudoStrategy);
    const localization = new ReactLocalization(bundles);

    const primaryLocale = languages[0];
    const direction = getLocaleDirection(primaryLocale, pseudoStrategy);
    receiveL10n(localization, primaryLocale, direction);
  }

  componentDidMount() {
    this._setupLocalization();
  }

  componentDidUpdate() {
    this._setupLocalization();
  }

  render() {
    return null;
  }
}

type InitProps = {|
  +requestL10n: (locales: string[]) => void,
  +requestedLocales: null | string[],
|};

/**
 * This component is responsible for initializing the locales as well as
 * persisting the current locale to localStorage.
 */
class AppLocalizationInit extends React.PureComponent<InitProps> {
  componentDidMount() {
    const { requestL10n } = this.props;
    requestL10n(this._getPersistedLocale() ?? navigator.languages);
  }

  componentDidUpdate() {
    this._persistCurrentLocale();
  }

  _getPersistedLocale(): string[] | null {
    let strPreviouslyRequestedLocales;
    try {
      strPreviouslyRequestedLocales = localStorage.getItem('requestedLocales');
    } catch (err) {
      console.warn(
        'We got an error while trying to retrieve the previously requested locale. Cookies might be blocked in this browser.',
        err
      );
    }

    if (strPreviouslyRequestedLocales) {
      try {
        const previouslyRequestedLocales = JSON.parse(
          strPreviouslyRequestedLocales
        );
        if (
          Array.isArray(previouslyRequestedLocales) &&
          previouslyRequestedLocales.length
        ) {
          return previouslyRequestedLocales;
        }

        console.warn(
          `The stored locale information (${strPreviouslyRequestedLocales}) looks incorrect.`
        );
      } catch (e) {
        console.warn(
          `We got an error when trying to parse the previously stored locale information (${strPreviouslyRequestedLocales}).`
        );
      }
    }

    return null;
  }

  _persistCurrentLocale() {
    const { requestedLocales } = this.props;
    if (!requestedLocales) {
      return;
    }

    try {
      localStorage.setItem(
        'requestedLocales',
        JSON.stringify(requestedLocales)
      );
    } catch (e) {
      console.warn(
        'We got an error when trying to save the current requested locale. We may run in private mode.',
        e
      );
    }
  }

  render() {
    return null;
  }
}

type L10nState = {|
  +requestedLocales: null | string[],
  +pseudoStrategy: PseudoStrategy,
  +localization: Localization,
  +primaryLocale: string | null,
  +direction: 'ltr' | 'rtl',
|};

type ProviderProps = {|
  children: React.Node,
|};

// Global reference to the AppLocalizationProvider instance for console access
let globalL10nProvider: AppLocalizationProvider | null = null;

/**
 * This component is responsible for providing the fluent localization data to
 * the components. It also updates the locale attributes on the document.
 * Moreover it delegates to AppLocalizationInit and AppLocalizationFetcher the
 * handling of initialization, persisting and fetching the locales information.
 */
export class AppLocalizationProvider extends React.PureComponent<
  ProviderProps,
  L10nState,
> {
  state: L10nState = {
    requestedLocales: null,
    pseudoStrategy: null,
    localization: new ReactLocalization([]),
    primaryLocale: null,
    direction: 'ltr',
  };

  componentDidMount() {
    this._updateLocalizationDocumentAttribute();
    globalL10nProvider = this;
  }

  componentWillUnmount() {
    if (globalL10nProvider === this) {
      globalL10nProvider = null;
    }
  }

  componentDidUpdate() {
    this._updateLocalizationDocumentAttribute();
  }

  _updateLocalizationDocumentAttribute() {
    const { primaryLocale, direction } = this.state;
    if (!primaryLocale) {
      // The localization isn't ready.
      return;
    }

    ensureExists(document.documentElement).setAttribute('dir', direction);
    ensureExists(document.documentElement).setAttribute('lang', primaryLocale);
  }

  _requestL10n = (locales: string[]) => {
    this.setState({ requestedLocales: locales });
  };

  _receiveL10n = (
    localization: Localization,
    primaryLocale: string,
    direction: 'ltr' | 'rtl'
  ) => {
    this.setState({ localization, primaryLocale, direction });
  };

  // Used by the global togglePseudoStrategy function for console access
  // eslint-disable-next-line react/no-unused-class-component-methods
  togglePseudoStrategy = (pseudoStrategy: PseudoStrategy) => {
    this.setState({ pseudoStrategy });
  };

  render() {
    const { primaryLocale, localization, requestedLocales, pseudoStrategy } =
      this.state;
    const { children } = this.props;

    const contextValue: L10nContextType = {
      primaryLocale,
      requestL10n: this._requestL10n,
    };

    return (
      <L10nContext.Provider value={contextValue}>
        <AppLocalizationInit
          requestL10n={this._requestL10n}
          requestedLocales={requestedLocales}
        />
        <AppLocalizationFetcher
          requestedLocales={requestedLocales}
          pseudoStrategy={pseudoStrategy}
          receiveL10n={this._receiveL10n}
        />
        {/* if primaryLocale is null, the localization isn't ready */}
        {primaryLocale ? (
          <LocalizationProvider l10n={localization}>
            {children}
          </LocalizationProvider>
        ) : null}
      </L10nContext.Provider>
    );
  }
}

// Hack: Expose a way to call globalL10nProvider.togglePseudoStrategy from window-console.js.
export function togglePseudoStrategy(pseudoStrategy: PseudoStrategy) {
  if (globalL10nProvider) {
    globalL10nProvider.togglePseudoStrategy(pseudoStrategy);
  }
}
