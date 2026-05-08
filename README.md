# AccountSwitcher

AccountSwitcher is an Equicord/Vencord user plugin for saving Discord account tokens locally and switching between saved accounts from the user area or keyboard shortcuts.

Made and maintained by [Nybotic](https://github.com/nybotic).

## Features

- Adds an account switcher button to the Discord user area.
- Saves the current account after you log in once.
- Switches saved accounts without retyping credentials.
- Assigns default hotkeys automatically: `Alt + 1`, `Alt + 2`, and so on.
- Supports optional password-based token encryption.
- Normalizes old saved account data and removes duplicate entries on startup.

## Install

Clone this repository into your Equicord user plugins folder:

```sh
git clone https://github.com/nybotic/AccountSwitcher src/userplugins/AccountSwitcher
```

Then rebuild or restart Equicord and enable `AccountSwitcher` in plugin settings.

## Usage

1. Log into the Discord account you want to save.
2. Open the plugin settings or the user area switcher.
3. Click `Save Current Account`.
4. Repeat for each account.
5. Use the user area button or the default `Alt + number` hotkeys to switch.

## Security Notes

- Saved tokens can log in as your Discord account. Treat them like passwords.
- Optional encryption protects saved tokens with a password before they are stored in plugin settings.
- If you forget the encryption password, the plugin cannot decrypt saved tokens.
- Logging out or removing a saved entry does not revoke the token. Change your Discord password if you need Discord to invalidate old tokens.

## Development

The plugin is intentionally small:

- `index.tsx` contains settings, token storage, encryption, hotkeys, and the switcher UI.
- `styles.css` contains the modal/settings layout.

Keep hotkey handling and render paths lightweight because they run while Discord is active.
