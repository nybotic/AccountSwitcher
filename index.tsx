/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 AccountSwitcher contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { Button } from "@components/Button";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Forms, React, showToast, TextInput, Toasts, UserStore, useState } from "@webpack/common";

interface SavedAccount {
    id: string;
    name: string;
    avatar?: string;
    token?: string;
    keybind: string[];
}

const AccountManager = findByPropsLazy("loginToken") as { loginToken(token: string): void; };
const TokenModule = findByPropsLazy("getToken") as { getToken(): string | null | undefined; };

let cachedPassword: string | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const modifierKeys = new Set(["CONTROL", "SHIFT", "ALT", "META"]);

const settings = definePluginSettings({
    accounts: {
        type: OptionType.COMPONENT,
        default: [] as SavedAccount[],
        component: AccountSwitcherSettings
    },
    encrypted: {
        type: OptionType.COMPONENT,
        default: false,
        component: () => null
    },
    encTest: {
        type: OptionType.COMPONENT,
        default: "",
        component: () => null
    },
    pluginsToRestart: {
        type: OptionType.COMPONENT,
        default: [] as string[],
        component: () => null
    }
});

function AccountSwitcherIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M7.5 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm9 1a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7ZM1.5 20.2c0-4 2.6-7.2 6-7.2s6 3.2 6 7.2c0 .4-.3.8-.8.8H2.3c-.5 0-.8-.4-.8-.8Zm11.8.8c.1-.3.2-.5.2-.8 0-2.2-.7-4.3-1.9-5.9 1.1-.8 2.7-1.3 4.4-1.3 3.6 0 6.5 2.4 6.5 5.4v1.8c0 .4-.3.8-.8.8h-8.4Z" />
        </svg>
    );
}

function normalizeAccountName(name: string) {
    const usernameMatch = name.match(/^.* \(@(.+)\)$/);
    if (usernameMatch) return usernameMatch[1];

    return name.replace(/#0{4}$/, "");
}

function normalizeAccount(account: Partial<SavedAccount>): SavedAccount | null {
    if (!account.id || !account.name) return null;

    return {
        id: String(account.id),
        name: normalizeAccountName(String(account.name)),
        avatar: account.avatar ? String(account.avatar) : undefined,
        token: account.token ? String(account.token) : undefined,
        keybind: Array.isArray(account.keybind) ? account.keybind.map(String) : []
    };
}

function cloneAccounts() {
    return ((settings.store.accounts ?? []) as Array<Partial<SavedAccount>>)
        .map(normalizeAccount)
        .filter((account): account is SavedAccount => Boolean(account));
}

function setAccounts(accounts: SavedAccount[]) {
    settings.store.accounts = accounts.map((account, index) => ({
        ...account,
        keybind: getDefaultKeybind(index)
    }));
}

function getDefaultKeybind(index: number) {
    if (index > 9) return [];

    const keyNumber = (index + 1) <= 9 ? index + 1 : 0;
    return ["ALT", `DIGIT${keyNumber}`];
}

function getAccountKeybind(index: number) {
    return getDefaultKeybind(index);
}

function normalizeKeybinds(accounts: SavedAccount[]) {
    let changed = false;

    for (let i = 0; i < accounts.length; i++) {
        const expected = getDefaultKeybind(i);
        if (accounts[i].keybind?.join("\0") !== expected.join("\0")) {
            accounts[i].keybind = expected;
            changed = true;
        }
    }

    return changed;
}

function dedupeAccounts(accounts: SavedAccount[]) {
    const seen = new Set<string>();
    let changed = false;

    for (let i = accounts.length - 1; i >= 0; i--) {
        const account = accounts[i];
        if (!seen.has(account.id)) {
            seen.add(account.id);
            continue;
        }

        accounts.splice(i, 1);
        changed = true;
    }

    return changed;
}

function normalizeSavedAccounts() {
    const accounts = cloneAccounts();
    let changed = accounts.length !== (settings.store.accounts ?? []).length;

    if (dedupeAccounts(accounts)) changed = true;
    if (normalizeKeybinds(accounts)) changed = true;

    if (changed) setAccounts(accounts);
    return changed;
}

function normalizeKeyName(event: KeyboardEvent) {
    if (event.code.startsWith("Digit") || event.code.startsWith("Numpad") || event.code.startsWith("Key")) {
        return event.code.toUpperCase();
    }

    if (event.key === " ") return "SPACE";
    return event.key.toUpperCase();
}

function eventToKeybind(event: KeyboardEvent) {
    const keys: string[] = [];
    if (event.ctrlKey) keys.push("CTRL");
    if (event.metaKey) keys.push("META");
    if (event.altKey) keys.push("ALT");
    if (event.shiftKey) keys.push("SHIFT");

    const main = normalizeKeyName(event);
    if (!modifierKeys.has(main)) keys.push(main);

    return keys;
}

function keybindLabel(keybind: string[]) {
    if (!keybind?.length) return "Unassigned";

    return keybind
        .map(key => key.replace(/^KEY/, "").replace(/^DIGIT/, ""))
        .join(" + ");
}

function matchesKeybind(event: KeyboardEvent, keybind: string[]) {
    if (!keybind?.length) return false;

    const pressed = eventToKeybind(event);
    if (keybind.length !== pressed.length) return false;

    const pressedKeys = new Set(pressed);
    return keybind.every(key => pressedKeys.has(key));
}

function shouldIgnoreKeybindTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;

    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function encodeBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
    const binary = atob(text);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function getKey(password: string, salt: Uint8Array<ArrayBuffer>) {
    const baseKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-CBC", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptToken(token: string, password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const key = await getKey(password, salt);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-CBC", iv },
        key,
        encoder.encode(token)
    ));

    return `v1:${encodeBase64(salt)}:${encodeBase64(iv)}:${encodeBase64(encrypted)}`;
}

async function decryptToken(payload: string, password: string) {
    const [version, saltText, ivText, encryptedText] = payload.split(":");
    if (version !== "v1" || !saltText || !ivText || !encryptedText) {
        throw new Error("Unsupported encrypted token format");
    }

    const key = await getKey(password, decodeBase64(saltText));
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv: decodeBase64(ivText) },
        key,
        decodeBase64(encryptedText)
    );

    return decoder.decode(decrypted);
}

function getCurrentAccountName(user: any) {
    return user.username ?? user.id;
}

function getCurrentToken() {
    return TokenModule.getToken?.();
}

function applyCurrentUserToAccount(account: SavedAccount, user: any, token: string) {
    account.name = getCurrentAccountName(user);
    account.avatar = user.getAvatarURL?.(void 0, 128, true);
    account.token = token;
}

function askPassword(title: string, body?: React.ReactNode, secondInput = false): Promise<string | [string, string]> {
    return new Promise((resolve, reject) => {
        openModal(props => {
            const [password, setPassword] = useState("");
            const [repeat, setRepeat] = useState("");

            return (
                <ModalRoot {...props} size={ModalSize.SMALL}>
                    <ModalHeader>
                        <Forms.FormTitle>{title}</Forms.FormTitle>
                        <ModalCloseButton onClick={() => {
                            props.onClose();
                            reject(new Error("cancelled"));
                        }} />
                    </ModalHeader>
                    <ModalContent className="vc-account-switcher-modal">
                        {body && <Forms.FormText>{body}</Forms.FormText>}
                        <TextInput
                            autoFocus
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={setPassword}
                            onKeyDown={e => {
                                if (e.key === "Enter" && !secondInput) {
                                    closeModalAndResolve(props.onClose, resolve, password);
                                }
                            }}
                        />
                        {secondInput && (
                            <TextInput
                                type="password"
                                placeholder="Repeat password"
                                value={repeat}
                                onChange={setRepeat}
                                onKeyDown={e => {
                                    if (e.key === "Enter") {
                                        closeModalAndResolve(props.onClose, resolve, [password, repeat]);
                                    }
                                }}
                            />
                        )}
                    </ModalContent>
                    <ModalFooter>
                        <Button onClick={() => closeModalAndResolve(props.onClose, resolve, secondInput ? [password, repeat] : password)}>
                            Confirm
                        </Button>
                    </ModalFooter>
                </ModalRoot>
            );
        }, {
            onCloseCallback: () => reject(new Error("cancelled"))
        });
    });
}

function closeModalAndResolve<T>(close: () => void, resolve: (value: T) => void, value: T) {
    close();
    resolve(value);
}

async function requirePassword() {
    if (!settings.store.encrypted) return null;
    if (cachedPassword) return cachedPassword;

    const password = await askPassword("Password required") as string;
    if (await decryptToken(settings.store.encTest, password) !== "test") {
        showToast("Wrong password", Toasts.Type.FAILURE);
        throw new Error("Wrong password");
    }

    cachedPassword = password;
    return password;
}

async function addCurrentAccount() {
    const user = UserStore.getCurrentUser();
    const token = getCurrentToken();
    if (!user || !token) {
        showToast("Could not read the current account token.", Toasts.Type.FAILURE);
        return;
    }

    const accounts = cloneAccounts();
    const existing = accounts.find(account => account.id === user.id);
    const password = await requirePassword();
    const savedToken = password ? await encryptToken(token, password) : token;

    if (existing) {
        const wasSaved = Boolean(existing.token);
        applyCurrentUserToAccount(existing, user, savedToken);
        setAccounts(accounts);
        showToast(`${wasSaved ? "Updated" : "Saved"} ${existing.name}.`, Toasts.Type.SUCCESS);
        return;
    }

    const account: SavedAccount = {
        id: user.id,
        name: getCurrentAccountName(user),
        avatar: user.getAvatarURL?.(void 0, 128, true),
        keybind: getDefaultKeybind(accounts.length),
        token: savedToken
    };

    setAccounts([...accounts, account]);
    showToast(`Saved ${account.name}.`, Toasts.Type.SUCCESS);
}

async function login(account: SavedAccount) {
    const currentUser = UserStore.getCurrentUser();
    if (currentUser?.id === account.id) {
        showToast(`Already using ${account.name}.`, Toasts.Type.MESSAGE);
        return;
    }

    try {
        const { token } = account;

        if (!token) throw new Error("This account has no saved token");

        const password = await requirePassword();
        AccountManager.loginToken(password ? await decryptToken(token, password) : token);
    } catch (error) {
        if ((error as Error).message !== "cancelled") {
            showToast("Could not switch accounts.", Toasts.Type.FAILURE);
            console.error("[AccountSwitcher]", error);
        }
    }
}

function openAccountSwitcherModal() {
    normalizeSavedAccounts();

    openModal(props => (
        <ModalRoot {...props} size={ModalSize.SMALL}>
            <ModalHeader>
                <Forms.FormTitle>Switch Account</Forms.FormTitle>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className="vc-account-switcher-modal">
                <AccountList onChange={() => undefined} onLogin={account => {
                    props.onClose();
                    void login(account);
                }} />
            </ModalContent>
            <ModalFooter>
                <Button onClick={() => void addCurrentAccount()}>
                    Save Current
                </Button>
                <Button variant="secondary" onClick={() => AccountManager.loginToken("")}>
                    Log Out
                </Button>
            </ModalFooter>
        </ModalRoot>
    ));
}

function AccountList({ onChange, onLogin }: { onChange(): void; onLogin(account: SavedAccount): void; }) {
    const accounts = settings.use(["accounts"]).accounts as SavedAccount[];

    if (!accounts.length) {
        return <Forms.FormText>No saved accounts yet.</Forms.FormText>;
    }

    return (
        <div className="vc-account-switcher-list">
            {accounts.map((account, index) => (
                <div className="vc-account-switcher-row" key={account.id}>
                    <img className="vc-account-switcher-avatar" src={account.avatar} alt="" />
                    <div className="vc-account-switcher-account">
                        <div className="vc-account-switcher-name">{account.name}</div>
                        <div className="vc-account-switcher-id">
                            {account.token ? account.id : "Needs Save Current Account"}
                        </div>
                    </div>
                    <Button
                        size="small"
                        disabled={!account.token}
                        onClick={() => onLogin(account)}
                    >
                        Switch
                    </Button>
                    <div className="vc-account-switcher-keybind">{keybindLabel(getAccountKeybind(index))}</div>
                    <Button
                        size="small"
                        variant="dangerPrimary"
                        onClick={() => {
                            setAccounts(cloneAccounts().filter(saved => saved.id !== account.id));
                            onChange();
                        }}
                    >
                        Remove
                    </Button>
                </div>
            ))}
        </div>
    );
}

function AccountSwitcherSettings() {
    const { encrypted } = settings.use(["encrypted"]);
    const [, rerender] = useState(0);

    const forceUpdate = () => rerender(n => n + 1);

    React.useEffect(() => {
        if (normalizeSavedAccounts()) forceUpdate();
    }, []);

    async function toggleEncryption(next: boolean) {
        if (next === settings.store.encrypted) return;

        try {
            if (next) {
                const [password, repeat] = await askPassword("Set Password", "Saved tokens will be encrypted with this password.", true) as [string, string];
                if (!password || password !== repeat) {
                    showToast("Passwords do not match.", Toasts.Type.FAILURE);
                    return;
                }

                settings.store.accounts = await Promise.all(cloneAccounts().map(async account => ({
                    ...account,
                    token: account.token ? await encryptToken(account.token, password) : account.token
                })));
                settings.store.encTest = await encryptToken("test", password);
                settings.store.encrypted = true;
                cachedPassword = password;
            } else {
                const password = await requirePassword();
                if (!password) return;

                settings.store.accounts = await Promise.all(cloneAccounts().map(async account => ({
                    ...account,
                    token: account.token ? await decryptToken(account.token, password) : account.token
                })));
                settings.store.encTest = "";
                settings.store.encrypted = false;
                cachedPassword = null;
            }

            forceUpdate();
        } catch (error) {
            if ((error as Error).message !== "cancelled") {
                showToast("Could not update encryption.", Toasts.Type.FAILURE);
                console.error("[AccountSwitcher]", error);
            }
        }
    }

    return (
        <div className="vc-account-switcher-settings">
            <div className="vc-account-switcher-actions">
                <Button onClick={() => void addCurrentAccount().then(forceUpdate)}>
                    Save Current Account
                </Button>
                <Button variant="secondary" onClick={() => AccountManager.loginToken("")}>
                    Log Out
                </Button>
                <Button variant={encrypted ? "dangerPrimary" : "primary"} onClick={() => void toggleEncryption(!encrypted)}>
                    {encrypted ? "Disable Encryption" : "Enable Encryption"}
                </Button>
            </div>
            <AccountList onChange={forceUpdate} onLogin={account => void login(account)} />
        </div>
    );
}

function AccountSwitcherButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Switch account"}
            icon={<AccountSwitcherIcon className={iconForeground} />}
            plated={nameplate != null}
            onClick={openAccountSwitcherModal}
        />
    );
}

function handleKeyDown(event: KeyboardEvent) {
    if (shouldIgnoreKeybindTarget(event.target)) return;

    const account = cloneAccounts().find((saved, index) => matchesKeybind(event, getAccountKeybind(index)));
    if (!account) return;

    event.preventDefault();
    event.stopPropagation();
    void login(account);
}

export default definePlugin({
    name: "AccountSwitcher",
    description: "Save accounts and switch between them from the user area or a hotkey.",
    tags: ["Utility", "Shortcuts"],
    authors: [{ name: "Nybotic", id: 0n }],
    source: "https://github.com/nybotic/AccountSwitcher",
    requiresRestart: false,
    settings,

    userAreaButton: {
        icon: AccountSwitcherIcon,
        render: AccountSwitcherButton
    },

    start() {
        normalizeSavedAccounts();
        document.addEventListener("keydown", handleKeyDown, true);
    },

    stop() {
        document.removeEventListener("keydown", handleKeyDown, true);
        cachedPassword = null;
    }
});
