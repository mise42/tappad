const DEVELOPMENT_VARIANT = 'development';

module.exports = ({ config }) => {
  if (process.env.TAPPAD_APP_VARIANT !== DEVELOPMENT_VARIANT) return config;

  return {
    ...config,
    name: 'TapPad Dev',
    slug: 'tappad-mobile-dev',
    scheme: 'tappad-dev',
    android: {
      ...config.android,
      package: 'com.miselabs.tappad.mobile.dev',
    },
  };
};
