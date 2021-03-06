/***************************************************************************
 * 
 * Copyright (c) 2014 Baidu.com, Inc. All Rights Reserved
 * $Id$ 
 * 
 **************************************************************************/
 
 
 
/**
 * lib/check-output.js ~ 2014/02/12 21:27:18
 * @author leeight(liyubei@baidu.com)
 * @version $Revision$ 
 * @description 
 * 检查项目build完毕之后output的内容是否正确
 * 1. css引用的img是否正确
 * 2. html引用的css是否正确（TODO）
 **/

/* jshint camelcase: false */

var edp = require( 'edp-core' );

var fs = require( 'fs' );
var path = require( 'path' );

/**
 * 检查css引用的图片是否正确
 * @param {string} file css文件的路径.
 */
function checkResouce( file ) {
    var data = edp.fs.readFileSync( file );
    var pattern = /\burl\s*\((["']?)([^\)]+)\1\)/g;
    var match = null;

    var invalidResource = [];
    while ( !!( match = pattern.exec( data ) ) ) {
        var url = match[2];
        // edp ERROR → output/dep/font-awesome/3.1.0/font/fontawesome-webfont.eot?v=3.1.0
        // edp ERROR → output/dep/font-awesome/3.1.0/font/fontawesome-webfont.eot?#iefix&v=3.1.0
        // edp ERROR → output/dep/font-awesome/3.1.0/font/fontawesome-webfont.woff?v=3.1.0
        // edp ERROR → output/dep/font-awesome/3.1.0/font/fontawesome-webfont.ttf?v=3.1.0
        // edp ERROR → output/dep/font-awesome/3.1.0/font/fontawesome-webfont.svg#fontawesomeregular?v=3.1.0
        if ( edp.path.isLocalPath( url ) ) {
            var resourceUrl = path.normalize( path.join(path.dirname(file), url) );
            resourceUrl = resourceUrl.replace(/[#\?].*$/g, '');
            if ( !fs.existsSync( resourceUrl ) ) {
                var relative = path.relative( process.cwd(), resourceUrl );
                if ( invalidResource.indexOf( relative )  === -1 ) {
                    invalidResource.push( relative );
                }
            }
        }
    }

    if (invalidResource.length) {
        edp.log.info('%s', path.relative(process.cwd(), file));
        invalidResource.forEach(function( resourceUrl ){
            edp.log.error( '→ %s', resourceUrl);
        });
    }
}

/**
 * 从output目录的html文件提取require.config的内容，生成module.conf，后续
 * 检查的时候计算模板路径依赖module.conf的内容.
 *
 * @see https://github.com/ecomfe/edp/issues/131
 * FIXME 我们从index.html里面读取了require.config的内容之后，写入到module.conf
 * 之前。需要给paths里面的配置项目添加baseUrl的前缀，否则可能导致计算路径的时候
 * 出错，但是这个逻辑以后是会修改的，因此记得参考ecomfe/edp#131这个issue的状态.
 */
function prepareModuleConfig() {
    var ok = false;
    var dir = 'output';

    if ( fs.existsSync( edp.path.join( dir, 'module.conf' ) ) ) {
        return true;
    }

    fs.readdirSync( dir ).every(
        function ( file ) {
            // 如果不是html文件，忽略之
            if ( !/.html?$/.test( file ) ) {
                // continue the loop
                return true;
            }

            var config = edp.esl.readLoaderConfig(
                fs.readFileSync( edp.path.resolve( dir, file ), 'utf-8' ) );
            if ( !config ) {
                // continue the loop
                return true;
            }

            var filename = edp.path.resolve( dir, 'module.conf' );
            var data = JSON.stringify( config.data, null, 4 );
            fs.writeFileSync( filename, data );
            ok = true;

            // break the loop
            return false;
        }
    );

    return ok;
}

/**
 * 检查js引用的模板路径是否正确
 */
function checkTemplate( file ) {
    var data = edp.fs.readFileSync( file );

    var ast = edp.esl.getAst( data, file );
    var moduleInfos = edp.esl.analyseModule( ast );
    if ( !moduleInfos ) {
        return;
    }

    if ( !(moduleInfos instanceof Array) ) {
        moduleInfos = [ moduleInfos ];
    }

    var invalidResource = [];
    for ( var i = 0; i < moduleInfos.length; i ++ ) {
        var moduleInfo = moduleInfos[ i ];
        invalidResource = invalidResource.concat(
            checkTemplateFromModuleInfo( moduleInfo, file )
        );
    }

    if (invalidResource.length) {
        edp.log.info('%s', path.relative(process.cwd(), file));
        invalidResource.forEach(function( resourceUrl ){
            edp.log.error( '→ %s', resourceUrl);
        });
    }
}

function checkTemplateFromModuleInfo( moduleInfo, file ) {
    var invalidResource = [];

    var actualDependencies = moduleInfo.actualDependencies;
    if ( !actualDependencies || actualDependencies.length <= 0 ) {
        return invalidResource;
    }

    var moduleConfigFile = path.join( process.cwd(), 'output', 'module.conf' );

    for ( var i = 0; i < actualDependencies.length; i ++) {
        var depId = actualDependencies[ i ];
        if ( depId.indexOf( '!' ) === -1 ) {
            continue;
        }

        var rv = edp.esl.toUrl( depId, moduleInfo.id, file, moduleConfigFile );
        var tpl = ( rv.resource || '' ).replace( /\.js$/, '' );

        // 有的项目里面会把tpl编译成js的
        if ( tpl && !( fs.existsSync( tpl ) || fs.existsSync( tpl + '.js' ) ) ) {
            if ( invalidResource.indexOf( tpl ) === -1 ) {
                invalidResource.push( tpl );
            }
        }
    }

    return invalidResource;
}

module.exports = function(args, opts) {
    edp.log.info('Checking output directory...');

    if ( !fs.existsSync( 'output' ) ) {
        return;
    }

    var FLAGS_enableCheckTemplate = true;
    if ( !prepareModuleConfig() ) {
        edp.log.warn( 'Prepare module config failed, skip `checkTemplate\'' );
        FLAGS_enableCheckTemplate = false;
    }

    edp.glob.sync( 'output/**/*.css' ).forEach( checkResouce );
    if ( FLAGS_enableCheckTemplate ) {
        edp.glob.sync( [ 'output/**/*.js', '!test/**', '!node_modules/**' ] ).forEach( checkTemplate );
    }

    // 清除output/module.conf文件
    try {
        fs.unlinkSync( 'output/module.conf' );
    } catch( ex ) {}
};





















/* vim: set ts=4 sw=4 sts=4 tw=100: */
