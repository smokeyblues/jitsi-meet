/* global __dirname */

const process = require('process');
const webpack = require('webpack');

const aui_css = __dirname + '/node_modules/@atlassian/aui/dist/aui/css/';

/**
 * The URL of the Jitsi Meet deployment to be proxy to in the context of
 * development with webpack-dev-server.
 */
const devServerProxyTarget
    = process.env.WEBPACK_DEV_SERVER_PROXY_TARGET || 'https://beta.meet.jit.si';

const minimize
    = process.argv.indexOf('-p') !== -1
        || process.argv.indexOf('--optimize-minimize') !== -1;
const node_modules = __dirname + '/node_modules/';
const plugins = [
    new webpack.LoaderOptionsPlugin({
        debug: !minimize,
        minimize: minimize
    })
];
const strophe = /\/node_modules\/strophe(js-plugins)?\/.*\.js$/;

if (minimize) {
    // XXX Webpack's command line argument -p is not enough. Further
    // optimizations are made possible by the use of DefinePlugin and NODE_ENV
    // with value 'production'. For example, React takes advantage of these.
    plugins.push(new webpack.DefinePlugin({
        'process.env': {
            NODE_ENV: JSON.stringify('production')
        }
    }));

    // While webpack will automatically insert UglifyJsPlugin when minimize is
    // true, the defaults of UglifyJsPlugin in webpack 1 and webpack 2 are
    // different. Explicitly state what we want even if we want defaults in
    // order to prepare for webpack 2.
    plugins.push(new webpack.optimize.UglifyJsPlugin({
        compress: {
            // It is nice to see warnings from UglifyJsPlugin that something is
            // unused and, consequently, is removed. The default is false in
            // webpack 2.
            warnings: true
        },
        extractComments: true,

        // Use the source map to map error message locations to modules. The
        // default is false in webpack 2.
        sourceMap: true
    }));
}

// The base Webpack configuration to bundle the JavaScript artifacts of
// jitsi-meet such as app.bundle.js and external_api.js.
const config = {
    devServer: {
        https: true,
        inline: true,
        proxy: {
            '/': {
                bypass: devServerProxyBypass,
                secure: false,
                target: devServerProxyTarget
            }
        }
    },
    devtool: 'source-map',
    module: {
        rules: [ {
            // Transpile ES2015 (aka ES6) to ES5. Accept the JSX syntax by React
            // as well.

            exclude: node_modules,
            loader: 'babel-loader',
            options: {
                // XXX The require.resolve bellow solves failures to locate the
                // presets when lib-jitsi-meet, for example, is npm linked in
                // jitsi-meet. The require.resolve, of course, mandates the use
                // of the prefix babel-preset- in the preset names.
                presets: [
                    [
                        require.resolve('babel-preset-es2015'),

                        // Tell babel to avoid compiling imports into CommonJS
                        // so that webpack may do tree shaking.
                        { modules: false }
                    ],
                    require.resolve('babel-preset-react'),
                    require.resolve('babel-preset-stage-1')
                ]
            },
            test: /\.jsx?$/
        }, {
            // Expose jquery as the globals $ and jQuery because it is expected
            // to be available in such a form by multiple jitsi-meet
            // dependencies including AUI, lib-jitsi-meet.

            loader: 'expose-loader?$!expose-loader?jQuery',
            test: /\/node_modules\/jquery\/.*\.js$/
        }, {
            // Disable AMD for the Strophe.js library or its imports will fail
            // at runtime.

            loader: 'imports-loader?define=>false&this=>window',
            test: strophe
        }, {
            // Set scope to window for URL polyfill.

            loader: 'imports-loader?this=>window',
            test: /\/node_modules\/url-polyfill\/.*\.js$/
        }, {
            // Allow CSS to be imported into JavaScript.

            test: /\.css$/,
            use: [
                'style-loader',
                'css-loader'
            ]
        }, {
            // Emit the static assets of AUI such as images that are referenced
            // by CSS into the output path.

            include: aui_css,
            loader: 'file-loader',
            options: {
                context: aui_css,
                name: '[path][name].[ext]'
            },
            test: /\.(gif|png|svg)$/
        } ],
        noParse: [

            // Do not parse the files of the Strophe.js library or at least
            // parts of the properties of the Strophe global variable will be
            // missing and strophejs-plugins will fail at runtime.
            strophe
        ]
    },
    node: {
        // Allow the use of the real filename of the module being executed. By
        // default Webpack does not leak path-related information and provides a
        // value that is a mock (/index.js).
        __filename: true
    },
    output: {
        filename: '[name]' + (minimize ? '.min' : '') + '.js',
        libraryTarget: 'umd',
        path: __dirname + '/build',
        publicPath: '/libs/',
        sourceMapFilename: '[name].' + (minimize ? 'min' : 'js') + '.map'
    },
    plugins: plugins,
    resolve: {
        alias: {
            jquery: 'jquery/dist/jquery' + (minimize ? '.min' : '') + '.js'
        },
        aliasFields: [
            'browser'
        ],
        extensions: [
            // Webpack 2 broke haste-resolver-webpack-plugin and I could not fix
            // it. But given that there is resolve.extensions and the only
            // non-default extension we have is .web.js, drop
            // haste-resolver-webpack-plugin and go with resolve.extensions.
            '.web.js',

            // Webpack defaults:
            '.js',
            '.json'
        ]
    }
};

const configs = [

    // The Webpack configuration to bundle app.bundle.js (aka APP).
    Object.assign({}, config, {
        entry: {
            'app.bundle': [
                // XXX Requried by at least IE11 at the time of this writing.
                'babel-polyfill',
                './app.js'
            ]
        },
        output: Object.assign({}, config.output, {
            library: 'APP'
        })
    }),

    // The Webpack configuration to bundle do_external_connect.js (which
    // attempts to optimize Jitsi Meet's XMPP connection and, consequently, is
    // also known as HTTP pre-bind).
    Object.assign({}, config, {
        entry: {
            'do_external_connect':
                './connection_optimization/do_external_connect.js'
        }
    }),

    // The Webpack configuration to bundle external_api.js (aka
    // JitsiMeetExternalAPI).
    Object.assign({}, config, {
        entry: {
            'external_api': './modules/API/external/index.js'
        },
        output: Object.assign({}, config.output, {
            library: 'JitsiMeetExternalAPI'
        })
    }),

    // The Webpack configuration to bundle popup_bundle.js (js file for the
    // device selection popup dialog).
    Object.assign({}, config, {
        entry: {
            'device_selection_popup_bundle':
                './react/features/device-selection/popup.js'
        },
        output: config.output
    })
];

module.exports = configs;

/**
 * Determines whether a specific (HTTP) request is to bypass the proxy of
 * webpack-dev-server (i.e. is to be handled by the proxy target) and, if not,
 * which local file is to be served in response to the request.
 *
 * @param {Object} request - The (HTTP) request received by the proxy.
 * @returns {string|undefined} If the request is to be served by the proxy
 * target, undefined; otherwise, the path to the local file to be served.
 */
function devServerProxyBypass(request) {
    let path = request.path;

    // Use local files from the css and libs directories.
    if (path.startsWith('/css/')) {
        return path;
    }
    if (configs.some(function (c) {
                if (path.startsWith(c.output.publicPath)) {
                    if (!minimize) {
                        // Since webpack-dev-server is serving non-minimized
                        // artifacts, serve them even if the minimized ones are
                        // requested.
                        Object.keys(c.entry).some(function (e) {
                            var name = e + '.min.js';

                            if (path.indexOf(name) !== -1) {
                                path = path.replace(name, e + '.js');

                                return true;
                            }
                        });
                    }

                    return true;
                }
            })) {
        return path;
    }
}
