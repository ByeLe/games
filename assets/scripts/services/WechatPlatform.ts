import { PlayerProfile, SharePayload } from '../model/GameTypes';
import { WECHAT_CLOUD_ENV_ID } from './WechatCloudConfig';

type WxSuccess<T> = T & { errMsg?: string };

interface WxApi {
    cloud?: {
        init: (options: { env: string; traceUser?: boolean }) => void;
        connectContainer?: (options: {
            service: string;
            path: string;
        }) => Promise<{ socketTask: {
            send(options: { data: string; success?: () => void; fail?: (error: unknown) => void }): void;
            close(options?: { code?: number; reason?: string }): void;
            onOpen(callback: () => void): void;
            onMessage(callback: (event: { data: string }) => void): void;
            onError(callback: (error: unknown) => void): void;
            onClose(callback: () => void): void;
        } }>;
        callFunction: <T = unknown>(options: {
            name: string;
            data?: Record<string, unknown>;
            success?: (res: { result: T }) => void;
            fail?: (error: unknown) => void;
        }) => Promise<{ result: T }> | void;
        downloadFile?: (options: {
            fileID: string;
            success?: (res: { tempFilePath: string }) => void;
            fail?: (error: unknown) => void;
        }) => Promise<{ tempFilePath: string }> | void;
        database?: () => {
            collection: (name: string) => {
                doc: (id: string) => {
                    watch?: (options: {
                        onChange: (snapshot: { docs?: unknown[] }) => void;
                        onError: (error: unknown) => void;
                    }) => { close?: () => void };
                    get?: () => Promise<{ data: unknown }>;
                };
            };
        };
    };
    getUserProfile?: (options: {
        desc: string;
        success?: (res: WxSuccess<{ userInfo: { nickName?: string; avatarUrl?: string } }>) => void;
        fail?: (error: unknown) => void;
    }) => Promise<WxSuccess<{ userInfo: { nickName?: string; avatarUrl?: string } }>> | void;
    createUserInfoButton?: (options: {
        type: 'text' | 'image';
        text?: string;
        style: {
            left: number;
            top: number;
            width: number;
            height: number;
            lineHeight?: number;
            backgroundColor?: string;
            color?: string;
            textAlign?: 'left' | 'center' | 'right';
            fontSize?: number;
            borderRadius?: number;
        };
    }) => {
        onTap: (handler: (res: WxSuccess<{ userInfo?: { nickName?: string; avatarUrl?: string } }>) => void) => void;
        destroy: () => void;
    };
    onNeedPrivacyAuthorization?: (
        handler: (
            resolve: (result: { event: 'agree' | 'disagree'; buttonId?: string }) => void,
            eventInfo?: unknown
        ) => void
    ) => void;
    requirePrivacyAuthorize?: (options: {
        success?: (res?: unknown) => void;
        fail?: (error: unknown) => void;
        complete?: (res?: unknown) => void;
    }) => Promise<unknown> | void;
    showModal?: (options: {
        title: string;
        content: string;
        confirmText?: string;
        cancelText?: string;
        success?: (res: { confirm?: boolean; cancel?: boolean }) => void;
        fail?: (error: unknown) => void;
    }) => void;
    getSystemInfoSync?: () => {
        windowWidth: number;
        windowHeight: number;
        statusBarHeight?: number;
        safeArea?: {
            top: number;
            bottom: number;
            left: number;
            right: number;
            width: number;
            height: number;
        };
    };
    showShareMenu?: (options: { withShareTicket?: boolean; menus?: string[] }) => void;
    onShareAppMessage?: (handler: () => { title: string; query: string }) => void;
    shareAppMessage?: (payload: { title: string; query: string }) => void;
    getLaunchOptionsSync?: () => { query?: Record<string, string> };
    login?: (options?: { success?: (res: { code?: string }) => void; fail?: (error: unknown) => void }) => Promise<{ code?: string }> | void;
    showToast?: (options: { title: string; icon?: 'success' | 'error' | 'loading' | 'none'; duration?: number }) => void;
}

export interface LaunchRoomPayload {
    roomId: string;
    joinToken: string;
}

export class WechatPlatform {
    private initialized = false;
    private currentShare: SharePayload | null = null;
    private privacyHandlerRegistered = false;

    isWechat(): boolean {
        return !!this.wx();
    }

    getSafeTopInset(designHeight: number): number {
        const systemInfo = this.wx()?.getSystemInfoSync?.();
        if (!systemInfo?.windowHeight) {
            return 0;
        }
        const topInset = systemInfo.safeArea?.top ?? systemInfo.statusBarHeight ?? 0;
        return Math.max(0, topInset / systemInfo.windowHeight * designHeight);
    }

    initCloud(): void {
        const wxApi = this.requireWx();
        if (!WECHAT_CLOUD_ENV_ID) {
            throw new Error('缺少微信云开发 envId。');
        }
        if (!wxApi.cloud?.init) {
            throw new Error('当前环境不支持微信云开发，请在微信开发者工具或微信小游戏中运行。');
        }
        if (!this.initialized) {
            wxApi.cloud.init({ env: WECHAT_CLOUD_ENV_ID, traceUser: true });
            this.initialized = true;
        }
        wxApi.showShareMenu?.({ withShareTicket: true, menus: ['shareAppMessage'] });
    }

    login(): Promise<string> {
        const wxApi = this.requireWx();
        if (!wxApi.login) {
            return Promise.reject(new Error('当前环境不支持微信登录。'));
        }
        return new Promise<string>((resolve, reject) => {
            const success = (result: { code?: string }) => result.code ? resolve(result.code) : reject(new Error('微信登录未返回 code。'));
            const result = wxApi.login?.({ success, fail: reject });
            if (result && typeof (result as Promise<{ code?: string }>).then === 'function') {
                (result as Promise<{ code?: string }>).then(success).catch(reject);
            }
        });
    }

    async requestProfile(): Promise<PlayerProfile> {
        const wxApi = this.requireWx();
        await this.ensurePrivacyAuthorization(wxApi);
        if (!wxApi.getUserProfile) {
            return this.requestProfileByButton(wxApi);
        }
        const result = await new Promise<WxSuccess<{ userInfo: { nickName?: string; avatarUrl?: string } }>>((resolve, reject) => {
            const fail = (error: unknown) => {
                console.error('[WechatPlatform] getUserProfile failed', error);
                reject(error);
            };
            const maybePromise = wxApi.getUserProfile?.({
                desc: '用于大话骰房间内展示昵称和头像',
                success: resolve,
                fail,
            });
            if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
                (maybePromise as Promise<WxSuccess<{ userInfo: { nickName?: string; avatarUrl?: string } }>>).then(resolve).catch(fail);
            }
        });
        const name = result.userInfo.nickName || '';
        const avatarUrl = result.userInfo.avatarUrl || '';
        if (!name || !avatarUrl) {
            console.error('[WechatPlatform] getUserProfile returned incomplete userInfo', result);
            throw new Error('需要授权头像昵称后才能联网游戏。');
        }
        return { name, avatarUrl };
    }

    private async requestProfileByButton(wxApi: WxApi): Promise<PlayerProfile> {
        await this.ensurePrivacyAuthorization(wxApi);
        if (!wxApi.createUserInfoButton) {
            throw new Error('当前基础库不支持获取头像昵称，请升级微信开发者工具或基础库。');
        }
        const systemInfo = wxApi.getSystemInfoSync?.() || { windowWidth: 360, windowHeight: 640 };
        const width = Math.min(240, systemInfo.windowWidth - 48);
        const height = 52;
        const button = wxApi.createUserInfoButton({
            type: 'text',
            text: '授权头像昵称',
            style: {
                left: (systemInfo.windowWidth - width) / 2,
                top: systemInfo.windowHeight / 2 + 48,
                width,
                height,
                lineHeight: height,
                backgroundColor: '#b86f37',
                color: '#fff1d0',
                textAlign: 'center',
                fontSize: 18,
                borderRadius: 8,
            },
        });
        return new Promise<PlayerProfile>((resolve, reject) => {
            button.onTap((result) => {
                const name = result.userInfo?.nickName || '';
                const avatarUrl = result.userInfo?.avatarUrl || '';
                button.destroy();
                if (!name || !avatarUrl) {
                    console.error('[WechatPlatform] user info button returned incomplete userInfo', result);
                    reject(new Error('需要授权头像昵称后才能联网游戏。'));
                    return;
                }
                resolve({ name, avatarUrl });
            });
        });
    }

    private async ensurePrivacyAuthorization(wxApi: WxApi): Promise<void> {
        this.registerPrivacyHandler(wxApi);
        if (!wxApi.requirePrivacyAuthorize) {
            return;
        }
        try {
            await new Promise<void>((resolve, reject) => {
                const maybePromise = wxApi.requirePrivacyAuthorize?.({
                    success: () => resolve(),
                    fail: reject,
                });
                if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
                    (maybePromise as Promise<unknown>).then(() => resolve()).catch(reject);
                }
            });
        } catch (error) {
            throw new Error(this.privacyErrorMessage(error));
        }
    }

    private registerPrivacyHandler(wxApi: WxApi): void {
        if (this.privacyHandlerRegistered || !wxApi.onNeedPrivacyAuthorization) {
            return;
        }
        wxApi.onNeedPrivacyAuthorization((resolve) => {
            if (!wxApi.showModal) {
                resolve({ event: 'agree', buttonId: 'agree-privacy' });
                return;
            }
            wxApi.showModal({
                title: '用户隐私保护提示',
                content: '联网模式需要使用你的昵称和头像，用于房间内展示玩家身份。请同意隐私授权后继续。',
                confirmText: '同意',
                cancelText: '拒绝',
                success: (res) => {
                    if (res.confirm) {
                        resolve({ event: 'agree', buttonId: 'agree-privacy' });
                        return;
                    }
                    resolve({ event: 'disagree' });
                },
                fail: () => resolve({ event: 'disagree' }),
            });
        });
        this.privacyHandlerRegistered = true;
    }

    private privacyErrorMessage(error: unknown): string {
        const text = this.errorMessage(error);
        if (
            text.includes('privacy') ||
            text.includes('official popup') ||
            text.includes('onNeedPrivacyAuthorization') ||
            text.includes('announce your privacy')
        ) {
            return '需要先同意微信隐私授权后才能获取头像昵称。请在隐私弹窗中同意后重试。';
        }
        return text;
    }

    getLaunchRoomPayload(): LaunchRoomPayload | null {
        const query = this.wx()?.getLaunchOptionsSync?.().query;
        const roomId = query?.roomId || query?.room || '';
        const joinToken = query?.joinToken || query?.token || '';
        return roomId ? { roomId, joinToken } : null;
    }

    setSharePayload(payload: SharePayload): void {
        this.currentShare = payload;
        this.wx()?.onShareAppMessage?.(() => ({
            title: payload.title,
            query: payload.query,
        }));
    }

    share(payload = this.currentShare): void {
        if (!payload) {
            return;
        }
        this.wx()?.shareAppMessage?.({
            title: payload.title,
            query: payload.query,
        });
    }

    toast(message: string): void {
        this.wx()?.showToast?.({ title: message, icon: 'none', duration: 1800 });
    }

    callFunction<T>(name: string, data: Record<string, unknown>): Promise<T> {
        const wxApi = this.requireWx();
        if (!wxApi.cloud?.callFunction) {
            return Promise.reject(new Error('当前环境不支持微信云函数。'));
        }
        return new Promise<T>((resolve, reject) => {
            const fail = (error: unknown) => {
                console.error(`[WechatPlatform] cloud function "${name}" failed`, error);
                reject(error);
            };
            const handleSuccess = (res: { result: T }) => {
                const result = res.result as T & { errMsg?: unknown; error?: unknown };
                if (result && typeof result === 'object' && (result.errMsg || result.error)) {
                    console.error(`[WechatPlatform] cloud function "${name}" returned error`, result);
                    reject(result);
                    return;
                }
                resolve(res.result);
            };
            const maybePromise = wxApi.cloud?.callFunction<T>({
                name,
                data,
                success: handleSuccess,
                fail,
            });
            if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
                (maybePromise as Promise<{ result: T }>).then(handleSuccess).catch(fail);
            }
        });
    }

    downloadCloudFile(fileID: string): Promise<string> {
        const wxApi = this.requireWx();
        if (!wxApi.cloud?.downloadFile) {
            return Promise.reject(new Error('当前环境不支持下载云存储文件。'));
        }
        return new Promise<string>((resolve, reject) => {
            const fail = (error: unknown) => {
                console.error('[WechatPlatform] download cloud file failed', { fileID, error });
                reject(error);
            };
            const maybePromise = wxApi.cloud?.downloadFile?.({
                fileID,
                success: (res) => resolve(res.tempFilePath),
                fail,
            });
            if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
                (maybePromise as Promise<{ tempFilePath: string }>).then((res) => resolve(res.tempFilePath)).catch(fail);
            }
        });
    }

    watchRoom(roomDocId: string, onChange: (doc: unknown) => void, onError: (error: unknown) => void): () => void {
        const db = this.requireWx().cloud?.database?.();
        const watcher = db?.collection('rooms').doc(roomDocId).watch?.({
            onChange: (snapshot) => {
                const doc = snapshot.docs?.[0];
                if (doc) {
                    onChange(doc);
                }
            },
            onError,
        });
        if (!watcher) {
            throw new Error('当前环境不支持云数据库实时监听。');
        }
        return () => watcher.close?.();
    }

    private wx(): WxApi | undefined {
        return (globalThis as { wx?: WxApi }).wx;
    }

    private requireWx(): WxApi {
        const wxApi = this.wx();
        if (!wxApi) {
            throw new Error('请在微信小游戏环境中使用联网模式。');
        }
        return wxApi;
    }

    private errorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'object' && error) {
            const detail = error as { errMsg?: unknown; message?: unknown; errno?: unknown; code?: unknown };
            const message = detail.errMsg || detail.message;
            if (message) {
                return String(message);
            }
            const code = detail.errno || detail.code;
            if (code) {
                return `操作失败：${String(code)}`;
            }
            try {
                return JSON.stringify(error);
            } catch (_error) {
                return '操作失败，请重试。';
            }
        }
        return String(error || '未知错误');
    }
}
