import { Compiler } from 'webpack';
import { ModuleFederationPluginOptions } from '@module-federation/utilities';
import AddModulesPlugin from '../AddModulesToRuntime';
import path from 'path';
import { DEFAULT_SHARE_SCOPE_BROWSER } from '../../internal';

/**
 * Applies server-specific plugins.
 *
 * @param compiler - The Webpack compiler instance.
 * @param options - The ModuleFederationPluginOptions instance.
 *
 * @remarks
 * The AddModulesPlugin lets us move modules between webpack chunks. In this case,
 * we are moving modules into the runtime chunks of the host and removing eager shared
 * modules from the remote container runtimes. This works around Next.js' lack of async
 * boundary, allowing us to execute the code more efficiently and with better performance.
 * By removing eager shared modules from the remote container runtimes, we can also improve
 * the load time of the application by reducing the amount of unnecessary code that needs
 * to be loaded.
 */
export function applyServerPlugins(
  compiler: Compiler,
  options: ModuleFederationPluginOptions
): void {
  // Import the StreamingTargetPlugin from @module-federation/node
  const { StreamingTargetPlugin } = require('@module-federation/node');
  // Add the AddModulesPlugin for the webpack runtime with eager loading and remote configuration
  new AddModulesPlugin({
    debug: false,
    runtime: 'webpack-runtime',
    eager: true,
    remotes: options.remotes,
    // @ts-ignore
    // shared: DEFAULT_SHARE_SCOPE_BROWSER,
    container: options.name,
    // @ts-ignore
    applicationName: options.name,
  }).apply(compiler);

  // new AddModulesPlugin({
  //   runtime: 'webpack-runtime',
  //   eager: true,
  //   remotes: options.remotes,
  // }).apply(compiler);
  //
  // // Add the AddModulesPlugin for the server with lazy loading and remote configuration
  // new AddModulesPlugin({
  //   runtime: options.name,
  //   eager: false,
  //   remotes: options.remotes,
  // }).apply(compiler);

  console.log(options);
  // Add the StreamingTargetPlugin with the ModuleFederationPlugin from the webpack container
  new StreamingTargetPlugin(options, {
    ModuleFederationPlugin: compiler.webpack.container.ModuleFederationPlugin,
  }).apply(compiler);
}

/**
 * Configures server-specific library and filename options.
 *
 * @param options - The ModuleFederationPluginOptions instance.
 *
 * @remarks
 * This function configures the library and filename options for server builds. The library option is
 * set to the commonjs-module format for chunks and the container, which allows them to be streamed over
 * to hosts with the NodeFederationPlugin. The filename option is set to the basename of the current
 * filename.
 */
export function configureServerLibraryAndFilename(
  options: ModuleFederationPluginOptions
): void {
  // Configure the library option with type "commonjs-module" and the name from the options
  options.library = {
    type: 'commonjs-module',
    name: options.name,
  };

  // Set the filename option to the basename of the current filename
  options.filename = path.basename(options.filename as string);
}

/**
 * Patches Next.js' default externals function to make sure shared modules are bundled and not treated as external.
 *
 * @param compiler - The Webpack compiler instance.
 * @param options - The ModuleFederationPluginOptions instance.
 *
 * @remarks
 * In server builds, all node modules are treated as external, which prevents them from being shared
 * via module federation. To work around this limitation, we mark shared modules as internalizable
 * modules that webpack puts into chunks that can be streamed to other runtimes as needed.
 *
 * This function replaces Next.js' default externals function with a new asynchronous function that
 * checks whether a module should be treated as external. If the module should not be treated as
 * external, the function returns without calling the original externals function. Otherwise, the
 * function calls the original externals function and retrieves the result. If the result is null,
 * the function returns without further processing. If the module is from Next.js or React, the
 * function returns the original result. Otherwise, the function returns null.
 */
export function handleServerExternals(
  compiler: Compiler,
  options: ModuleFederationPluginOptions
): void {
  // Check if the compiler has an `externals` array
  if (
    Array.isArray(compiler.options.externals) &&
    compiler.options.externals[0]
  ) {
    // Retrieve the original externals function
    const originalExternals = compiler.options.externals[0];

    // Replace the original externals function with a new asynchronous function
    compiler.options.externals[0] = async function (ctx, callback) {
      // Check if the module should not be treated as external
      if (
        ctx.request &&
        (ctx.request.includes('@module-federation/utilities') ||
          ctx.request.includes('internal-delegate-hoist') ||
          Object.keys(options.shared || {}).some((key) => {
            return (
              //@ts-ignore
              options.shared?.[key]?.import !== false &&
              ctx?.request?.includes(key)
            );
          }) ||
          ctx.request.includes('@module-federation/dashboard-plugin'))
      ) {
        // If the module should not be treated as external, return without calling the original externals function
        return;
      }

      // Call the original externals function and retrieve the result
      // @ts-ignore
      const fromNext = await originalExternals(ctx, callback);

      // If the result is null, return without further processing
      if (!fromNext) {
        return;
      }

      // If the module is from Next.js or React, return the original result
      const req = fromNext.split(' ')[1];
      if (req.startsWith('next') || req.startsWith('react')) {
        return fromNext;
      }

      // Otherwise, return null
      return;
    };
  }
}
