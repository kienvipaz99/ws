import * as http from 'http';
import * as https from 'https';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import * as process from 'process';
import { EnvName } from '../EnvName';
import cors from 'cors';
const DEFAULT_STATIC_DIR = path.join(__dirname, './public');

const PATHNAME = process.env[EnvName.WS_SCRCPY_PATHNAME] || __PATHNAME__;

export type ServerAndPort = {
    server: https.Server | http.Server;
    port: number;
};

interface HttpServerEvents {
    started: boolean;
}

export class HttpServer extends TypedEmitter<HttpServerEvents> implements Service {
    private static instance: HttpServer;
    private static PUBLIC_DIR = DEFAULT_STATIC_DIR;
    private static SERVE_STATIC = true;
    private servers: ServerAndPort[] = [];
    private mainApp?: Express;
    private started = false;
    protected constructor() {
        super();
    }

    public static getInstance(): HttpServer {
        if (!this.instance) {
            this.instance = new HttpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public static setPublicDir(dir: string): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.PUBLIC_DIR = dir;
    }

    public static setServeStatic(enabled: boolean): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.SERVE_STATIC = enabled;
    }

    public async getServers(): Promise<ServerAndPort[]> {
        if (this.started) {
            return [...this.servers];
        }
        return new Promise<ServerAndPort[]>((resolve) => {
            this.once('started', () => {
                resolve([...this.servers]);
            });
        });
    }

    public getName(): string {
        return `HTTP(s) Server Service`;
    }

    public async start(): Promise<void> {
        this.mainApp = express();

        // Apply CORS middleware to allow cross-origin requests
        this.mainApp.use(cors());

        // Middleware to parse JSON bodies
        this.mainApp.use(express.json());

        // Serve static files if configured
        if (HttpServer.SERVE_STATIC && HttpServer.PUBLIC_DIR) {
            this.mainApp.use(PATHNAME, express.static(HttpServer.PUBLIC_DIR));
        }

        // Define routes
        // this.mainApp.get('/api/link', (_req: Request, res: any) => {
        //     ;

        //     const link = [] as string[];
        //     devices.forEach((item) => {
        //         if (item.state == 'device') {
        //             link.push(
        //                 `http://localhost:64001/#!action=stream&udid=${item.udid}&player=webcodecs&ws=ws%3A%2F%2Flocalhost%3A64001%2F%3Faction%3Dproxy-adb%26remote%3Dtcp%253A8886%26udid%3D${item.udid}`,
        //             );
        //         }
        //     });
        //     res.status(200).json(link);
        // });

        const config = Config.getInstance();
        config.servers.forEach((serverItem) => {
            const { secure, port, redirectToSecure } = serverItem;
            let proto: string;
            let server: http.Server | https.Server;

            if (secure) {
                if (!serverItem.options) {
                    throw new Error('Must provide option for secure server configuration');
                }
                server = https.createServer(serverItem.options, this.mainApp);
                proto = 'https';
            } else {
                const options = serverItem.options ? { ...serverItem.options } : {};
                proto = 'http';
                let currentApp = this.mainApp;
                let redirectPort = 443;
                let redirectHost = '';
                let doRedirect = false;

                if (redirectToSecure === true) {
                    doRedirect = true;
                } else if (typeof redirectToSecure === 'object') {
                    doRedirect = true;
                    if (typeof redirectToSecure.port === 'number') {
                        redirectPort = redirectToSecure.port;
                    }
                    if (typeof redirectToSecure.host === 'string') {
                        redirectHost = redirectToSecure.host;
                    }
                }

                if (doRedirect) {
                    currentApp = express();
                    currentApp.use((req, res) => {
                        const url = new URL(`https://${redirectHost || req.headers.host}${req.url}`);
                        if (redirectPort && redirectPort !== 443) {
                            url.port = redirectPort.toString();
                        }
                        return res.redirect(301, url.toString());
                    });
                }

                server = http.createServer(options, currentApp);
            }

            this.servers.push({ server, port });
            server.listen(port, () => {
                Utils.printListeningMsg(proto, port, PATHNAME);
            });
        });

        this.started = true;
        this.emit('started', true);
    }

    public release(): void {
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}
